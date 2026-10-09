'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Languages,
  Plus,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import type { OperationActor } from '@/lib/request-operations';
import { isEditableTranslation } from '@/lib/i18n/editable';
import messages from '@/lib/i18n/en.json';
import patterns from '@/lib/i18n/patterns.json';
import categories from '@/lib/i18n/categories.json';
import {
  emptyTranslations,
  readTranslations,
  saveTranslations,
  validateTranslation,
  type TranslationRecord,
} from '@/lib/i18n/store';

const sections = [
  ['buttons', '按钮'],
  ['fields', '字段'],
  ['messages', '提示文本'],
  ['navigation', '导航与标题'],
  ['statuses', '状态与选项'],
  ['content', '其他文本'],
] as const;
const sectionLabels: Record<string, string> = Object.fromEntries(sections);
const bundledDefaults: Record<string, string> = { ...messages, ...Object.fromEntries(patterns) };
const defaults: Record<string, string> = Object.fromEntries(Object.entries(bundledDefaults).filter(([key]) => isEditableTranslation(key)));
const groups: Record<string, string> = categories;
const pageSize = 40;
type Editor = { original: string | null; source: string; english: string };

export function TranslationWorkbench({ actor }: { actor: OperationActor }) {
  const [record, setRecord] = useState<TranslationRecord>(emptyTranslations);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const writable = canManageRouting(actor);
  const valueOf = (key: string) => record.labels[key] ?? defaults[key] ?? '';
  const dirty =
    !!editor &&
    (editor.original === null
      ? !!(editor.source || editor.english)
      : editor.english !== valueOf(editor.original));

  useEffect(() => {
    let active = true;
    readTranslations()
      .then((value) => {
        if (active) {
          setRecord(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError('翻译读取失败，请退出后重新进入。');
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty && !busy) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const leave = (event: Event) => {
      if (busy || !window.confirm('翻译有未保存的修改，是否放弃并离开？'))
        event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    window.addEventListener('service-before-navigation', leave);
    return () => {
      window.removeEventListener('beforeunload', guard);
      window.removeEventListener('service-before-navigation', leave);
    };
  }, [dirty, busy]);

  const allKeys = useMemo(
    () => [
      ...new Set([...Object.keys(defaults), ...Object.keys(record.labels)].filter(isEditableTranslation)),
    ],
    [record],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = allKeys.filter(
    (key) =>
      (!category || (groups[key] ?? 'content') === category) &&
      (!status || (record.labels[key] ? 'custom' : 'default') === status) &&
      (!normalizedQuery ||
        `${key} ${valueOf(key)}`.toLowerCase().includes(normalizedQuery)),
  );
  const customized = filtered.filter((key) =>
    Object.hasOwn(record.labels, key),
  ).length;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  function openEditor(key: string | null) {
    setFormError('');
    setNotice('');
    setEditor({
      original: key,
      source: key ?? '',
      english: key === null ? '' : valueOf(key),
    });
  }
  function closeEditor() {
    if (busy || (dirty && !window.confirm('翻译有未保存的修改，是否放弃？')))
      return;
    setEditor(null);
    setFormError('');
  }
  async function persist(labels: Record<string, string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveTranslations(actor, labels, record.revision);
      setRecord(saved);
      setNotice('翻译已保存，英文前台已生效。');
      return true;
    } finally {
      setBusy(false);
    }
  }
  async function saveEditor() {
    if (!editor || busy || !writable) return;
    const source = editor.source.trim(),
      english = editor.english.trim();
    const issue = isEditableTranslation(source) ? validateTranslation(source, english) : '活动模板由系统维护，请在此修改界面标签。';
    if (issue) {
      setFormError(issue);
      return;
    }
    if (editor.original === null && allKeys.includes(source)) {
      setFormError('该中文原文已存在，请通过搜索修改。');
      return;
    }
    const labels = { ...record.labels };
    if (english === defaults[source]) delete labels[source];
    else labels[source] = english;
    setFormError('');
    try {
      if (await persist(labels)) {
        if (editor.original === null) {
          setCategory('');
          setStatus('');
          setQuery(source);
          setPage(1);
        }
        setEditor(null);
      }
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : '保存失败，修改内容已保留。',
      );
    }
  }
  async function restore(key: string) {
    if (busy || !writable) return;
    const labels = { ...record.labels };
    delete labels[key];
    try {
      await persist(labels);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '恢复默认翻译失败，请重试。',
      );
    }
  }

  return (
    <section
      className="reference-panel permission-settings translation-workbench"
      aria-label="翻译台"
    >
      <div className="permission-heading">
        <div className="permission-heading-title">
          <Languages size={22} />
          <h2>翻译清单</h2>
          <span className="permission-readonly">中文 → English</span>
        </div>
        {writable && (
          <Button
            className="ct-button ct-button--primary"
            disabled={!ready || busy}
            onClick={() => openEditor(null)}
          >
            <Plus size={16} />
            新增翻译
          </Button>
        )}
      </div>
      <div className="permission-filters">
        <label htmlFor="translation-category">
          翻译分类
          <NativeSelect
            id="translation-category"
            value={category}
            onChange={(event) => change(setCategory, event.target.value)}
          >
            <option value="">全部分类</option>
            {sections.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label htmlFor="translation-status">
          翻译状态
          <NativeSelect
            id="translation-status"
            value={status}
            onChange={(event) => change(setStatus, event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="default">默认翻译</option>
            <option value="custom">已自定义</option>
          </NativeSelect>
        </label>
        <label htmlFor="translation-query">
          搜索中文或英文
          <div className="permission-search">
            <Search size={16} />
            <Input
              id="translation-query"
              value={query}
              placeholder="搜索中文原文或英文翻译"
              onChange={(event) => change(setQuery, event.target.value)}
            />
          </div>
        </label>
      </div>
      <div className="permission-summary" aria-live="polite">
        <span>
          共 <strong>{filtered.length}</strong> 条
        </span>
        <span>
          默认翻译 <strong>{filtered.length - customized}</strong>
        </span>
        <span>
          已自定义 <strong>{customized}</strong>
        </span>
        <Button
          variant="ghost"
          onClick={() => {
            setCategory('');
            setStatus('');
            setQuery('');
            setPage(1);
          }}
        >
          重置筛选
        </Button>
      </div>
      {error && (
        <p role="alert" className="sr-error translation-feedback">
          {error}
        </p>
      )}
      {notice && (
        <output className="translation-feedback" aria-live="polite">
          {notice}
        </output>
      )}
      <div className="table-scroll permission-table-scroll">
        <table className="reference-table app-list-table translation-list-table">
          <caption className="sr-only">中文原文与英文展示翻译清单</caption>
          <thead>
            <tr>
              <th>翻译分类</th>
              <th>中文原文</th>
              <th>英文翻译</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {!ready ? (
              <tr>
                <td colSpan={5} className="translation-empty">
                  正在读取翻译…
                </td>
              </tr>
            ) : visible.length ? (
              visible.map((key) => (
                <tr key={key}>
                  <td>{sectionLabels[groups[key] ?? 'content']}</td>
                  <td>{key}</td>
                  <td lang="en">{valueOf(key)}</td>
                  <td>
                    <span
                      className="permission-result"
                      data-tone={record.labels[key] ? 'allowed' : 'neutral'}
                    >
                      {record.labels[key] ? '已自定义' : '默认翻译'}
                    </span>
                  </td>
                  <td>
                    <div className="translation-row-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!writable || busy}
                        onClick={() => openEditor(key)}
                      >
                        编辑
                      </Button>
                      {defaults[key] && record.labels[key] && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!writable || busy}
                          onClick={() => void restore(key)}
                        >
                          恢复默认
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="translation-empty">
                  没有符合当前筛选条件的翻译
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="permission-pagination">
        <span>
          第 {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–
          {Math.min(currentPage * pageSize, filtered.length)} 条，共{' '}
          {filtered.length} 条
        </span>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={15} />
            上一页
          </Button>
          <span>
            {currentPage} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            下一页
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogContent className="translation-editor-dialog">
          <DialogHeader>
            <DialogTitle>
              {editor?.original === null ? '新增翻译' : '编辑翻译'}
            </DialogTitle>
          </DialogHeader>
          <div className="sr-form-grid translation-editor-fields">
            <label htmlFor="translation-source">
              中文原文
              <Textarea
                id="translation-source"
                value={editor?.source ?? ''}
                readOnly={editor?.original !== null}
                disabled={busy}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, source: event.target.value } : null,
                  )
                }
              />
            </label>
            <label htmlFor="translation-english">
              英文翻译
              <Textarea
                id="translation-english"
                lang="en"
                value={editor?.english ?? ''}
                disabled={busy}
                onChange={(event) =>
                  setEditor((current) =>
                    current
                      ? { ...current, english: event.target.value }
                      : null,
                  )
                }
              />
            </label>
          </div>
          {formError && (
            <p role="alert" className="sr-error">
              {formError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={closeEditor}>
              取消
            </Button>
            <Button
              disabled={busy || !dirty || !writable}
              onClick={() => void saveEditor()}
            >
              {busy ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
