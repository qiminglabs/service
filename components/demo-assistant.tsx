'use client';
import { useI18n } from '@/lib/i18n/context';


import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { readSiteContent } from '@/lib/demo-assistant-reader';
import { MessageCircle, Send, X, RotateCcw } from 'lucide-react';
import { assistantPages, assistantTabs, normalizeAssistantContext, type AssistantContext } from '@/lib/demo-assistant-context';

type Message = { role: 'user' | 'assistant'; content: string; page: string };
function readContext(): AssistantContext {
  const main = document.querySelector('[data-assistant-page]');
  const selected = Array.from(main?.querySelectorAll('[data-assistant-tab][aria-selected="true"]') || []).map(tab => tab.getAttribute('data-assistant-tab')).find(text => assistantTabs.includes(text as never));
  return normalizeAssistantContext({ page: main?.getAttribute('data-assistant-page'), tab: selected || main?.getAttribute('data-assistant-reference-tab'), status: main?.querySelector('[data-assistant-status]')?.getAttribute('data-assistant-status') });
}
export function DemoAssistant() {
  const { localize, locale, localizeMessage } = useI18n();
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<AssistantContext>({ page: 'requests' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const floating = useRef<HTMLDivElement>(null);
  // Position deliberately lives only in memory: a refresh restores CSS defaults.
  const [position, setPosition] = useState<{ right: number; bottom: number }>();
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  function constrain(right: number, bottom: number) {
    const rect = floating.current!.getBoundingClientRect();
    return {
      right: Math.max(12, Math.min(right, window.innerWidth - rect.width - 12)),
      bottom: Math.max(12, Math.min(bottom, window.innerHeight - rect.height - 12)),
    };
  }
  useLayoutEffect(() => {
    const keepVisible = () => {
      const rect = floating.current?.getBoundingClientRect();
      if (!rect) return;
      const next = constrain(window.innerWidth - rect.right, window.innerHeight - rect.bottom);
      setPosition(previous => {
        if (!previous && rect.left >= 12 && rect.top >= 12 && rect.right <= window.innerWidth - 12 && rect.bottom <= window.innerHeight - 12) return previous;
        return previous?.right === next.right && previous?.bottom === next.bottom ? previous : next;
      });
    };
    const observer = new ResizeObserver(keepVisible);
    observer.observe(floating.current!);
    window.addEventListener('resize', keepVisible);
    return () => { observer.disconnect(); window.removeEventListener('resize', keepVisible); };
  }, []);
  function startDrag(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('.demo-assistant-tools')) return;
    const rect = floating.current!.getBoundingClientRect();
    suppressClick.current = false;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true; suppressClick.current = true; setDragging(true);
    setPosition(constrain(current.right - dx, current.bottom - dy));
  }
  function endDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const dragHandlers = { onPointerDown: startDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag };
  useEffect(() => {
    const update = () => { const next = readContext(); setContext(old => JSON.stringify(old) === JSON.stringify(next) ? old : next); };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-assistant-page', 'data-assistant-reference-tab', 'data-assistant-status', 'data-assistant-tab', 'aria-selected'] });
    return () => { observer.disconnect(); controller.current?.abort(); };
  }, []);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy, error, open]);
  function close() { setOpen(false); launcher.current?.focus(); }
  function clear() { controller.current?.abort(); controller.current = null; setBusy(false); setMessages([]); setError(''); setQuestion(''); input.current?.focus(); }
  async function send(text = question) {
    const trimmed = text.trim();
    if (!trimmed || controller.current || trimmed.length > 1500) return;
    const snapshot = readContext();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true); setError(''); setQuestion('');
    const previous = messages;
    setMessages([...previous, { role: 'user', content: trimmed, page: assistantPages[snapshot.page] }]);
    try {
      const siteContent = await readSiteContent();
      if (controller.current !== pending) return;
      const response = await fetch('/api/assistant', {
        // Preserve the same-origin session when the site is protected by IAP.
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ question: trimmed, context: { ...snapshot, ...(locale === 'en' ? { locale: 'en' } : {}) }, siteContent, history: previous.slice(-8).map(({ role, content }) => ({ role, content })) }),
        signal: AbortSignal.any([pending.signal, AbortSignal.timeout(100_000)]),
      });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || typeof data.answer !== 'string') throw new Error(typeof data.error === 'string' ? data.error : '暂时无法回答，请稍后重试。');
      if (controller.current !== pending) return;
      const answer = data.answer;
      setMessages(current => [...current, { role: 'assistant', content: answer, page: assistantPages[snapshot.page] }]);
    } catch (failure) {
      if (controller.current !== pending) return;
      setMessages(previous); setQuestion(trimmed);
      setError(failure instanceof Error && failure.name === 'Error' ? failure.message : '连接失败或超时，请重试。');
    } finally { if (controller.current === pending) { controller.current = null; setBusy(false); input.current?.focus(); } }
  }
  return <div ref={floating} className="demo-assistant" style={position} data-dragging={dragging || undefined}>
    {localize(open && <section id="demo-assistant-panel" className="demo-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="demo-assistant-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header className="demo-assistant-header" {...dragHandlers}><div><strong id="demo-assistant-title">{localize("Demo 功能助手")}</strong></div><div className="demo-assistant-tools"><button type="button" title={localize("清空对话")} aria-label={localize("清空对话")} onClick={clear}><RotateCcw size={17} /></button><button type="button" aria-label={localize("收起功能助手")} onClick={close}><X size={20} /></button></div></header>
      <div className="demo-assistant-context">{localize("当前页面：")}{localize(assistantPages[context.page])}{localize(context.status ? localizeMessage(" · {0}", [String(localize(context.status))]) : '')}</div>
      <div className="demo-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
        {localize(!messages.length && <div className="demo-assistant-welcome"><MessageCircle size={28} /><h2>{localize("想了解哪个功能？")}</h2><p>{localize("我可以解释为什么、在哪里操作，以及下一步怎么做。")}</p><div className="demo-assistant-suggestions">{localize(['这个页面可以做什么？', '为什么找不到可申请的服务？', '哪些功能只是本地模拟？'].map(text => <button key={text} disabled={busy} onClick={() => void send(text)}>{localize(text)}</button>))}</div></div>)}
        {localize(messages.map((message, index) => <article key={index} className={`demo-assistant-message demo-assistant-message--${message.role}`}><small>{localize(message.role === 'user' ? '你' : '功能助手')} · {localize(message.page)}</small><p>{localize(message.content)}</p></article>))}
        {localize(busy && <p className="demo-assistant-pending" role="status">{localize("正在查阅 Demo 功能说明…")}</p>)}
        {localize(error && <p className="demo-assistant-error" role="alert">{localize(error)}</p>)}<div ref={end} />
      </div>
      <form className="demo-assistant-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="demo-assistant-question">{localize("你的功能问题")}</label><textarea ref={input} id="demo-assistant-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1500} rows={2} disabled={busy} placeholder={localize("例如：待确认之后，下一步是什么？")} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void send(); } }} />
        <div><button type="submit" disabled={busy || !question.trim()} aria-label={localize("发送问题")}><Send size={18} /></button></div>
      </form>
    </section>)}
    <button ref={launcher} className="demo-assistant-launcher" type="button" title={localize("点击打开或收起，拖动调整位置")} {...dragHandlers} aria-expanded={open} aria-controls="demo-assistant-panel" onClick={event => { if (event.detail !== 0 && suppressClick.current) { suppressClick.current = false; return; } setOpen(value => !value); }}><MessageCircle size={21} />{localize(open ? '收起助手' : '功能助手')}</button>
  </div>;
}
