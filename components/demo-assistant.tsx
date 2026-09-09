'use client';

import { useEffect, useRef, useState } from 'react';
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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
        body: JSON.stringify({ question: trimmed, context: snapshot, siteContent, history: previous.slice(-8).map(({ role, content }) => ({ role, content })) }),
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
  return <div className="demo-assistant">
    {open && <section id="demo-assistant-panel" className="demo-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="demo-assistant-title" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <header className="demo-assistant-header"><div><strong id="demo-assistant-title">Demo 功能助手</strong></div><div className="demo-assistant-tools"><button type="button" title="清空对话" aria-label="清空对话" onClick={clear}><RotateCcw size={17} /></button><button type="button" aria-label="收起功能助手" onClick={close}><X size={20} /></button></div></header>
      <div className="demo-assistant-context">当前页面：{assistantPages[context.page]}{context.status ? ` · ${context.status}` : ''}</div>
      <div className="demo-assistant-messages" role="log" aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
        {!messages.length && <div className="demo-assistant-welcome"><MessageCircle size={28} /><h2>想了解哪个功能？</h2><p>我可以解释为什么、在哪里操作，以及下一步怎么做。</p><div className="demo-assistant-suggestions">{['这个页面可以做什么？', '为什么找不到可申请的服务？', '哪些功能只是本地模拟？'].map(text => <button key={text} disabled={busy} onClick={() => void send(text)}>{text}</button>)}</div></div>}
        {messages.map((message, index) => <article key={index} className={`demo-assistant-message demo-assistant-message--${message.role}`}><small>{message.role === 'user' ? '你' : '功能助手'} · {message.page}</small><p>{message.content}</p></article>)}
        {busy && <p className="demo-assistant-pending" role="status">正在查阅 Demo 功能说明…</p>}
        {error && <p className="demo-assistant-error" role="alert">{error}</p>}<div ref={end} />
      </div>
      <form className="demo-assistant-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="demo-assistant-question">你的功能问题</label><textarea ref={input} id="demo-assistant-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={1500} rows={2} disabled={busy} placeholder="例如：待确认之后，下一步是什么？" onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void send(); } }} />
        <div><button type="submit" disabled={busy || !question.trim()} aria-label="发送问题"><Send size={18} /></button></div>
      </form>
    </section>}
    <button ref={launcher} className="demo-assistant-launcher" type="button" aria-expanded={open} aria-controls="demo-assistant-panel" onClick={() => setOpen(value => !value)}><MessageCircle size={21} />{open ? '收起助手' : '功能助手'}</button>
  </div>;
}
