'use client';

import { RequiredMark } from '@/components/required-mark';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ExecutionFormBuilder } from '@/components/service-execution-form-builder';
import { ExecutionFormPreview } from '@/components/service-execution-form-preview';
import { canManageRouting } from '@/lib/assessment-routing-store';
import {
  readExecutionFormData,
  saveExecutionForms,
} from '@/lib/service-execution-form-store';
import {
  newExecutionForm,
  parseExecutionForm,
  type ExecutionForm,
  type ExecutionFormLibrary,
} from '@/lib/service-execution-forms';
import type { OperationActor } from '@/lib/request-operations';

export function ServiceExecutionFormSettings({
  actor,
}: {
  actor: OperationActor;
}) {
  const [library, setLibrary] = useState<ExecutionFormLibrary>();
  const [draft, setDraft] = useState<ExecutionForm>();
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [query, setQuery] = useState('');
  const [preview, setPreview] = useState<ExecutionForm>(),
    [remove, setRemove] = useState<ExecutionForm>(),
    [back, setBack] = useState(false);
  const lock = useRef(false);
  const disabled = busy || !library || !canManageRouting(actor);
  async function reload() {
    try {
      setLibrary((await readExecutionFormData()).library);
      setError('');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '表单读取失败。');
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function save(next: ExecutionFormLibrary) {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveExecutionForms(next, actor);
      setLibrary(saved);
      setDraft(undefined);
      setDirty(false);
      setRemove(undefined);
      setNotice('服务步骤表单已保存。');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '保存失败。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function change(form: ExecutionForm) {
    if (disabled) return;
    setDraft(form);
    setDirty(true);
    setError('');
  }
  function saveDraft() {
    if (!draft || !library) return;
    try {
      const checked = parseExecutionForm({
        ...draft,
        fields: draft.fields.map((field) => ({
          ...field,
          options: field.options.map((option) => option.trim()).filter(Boolean),
        })),
      });
      void save({
        ...library,
        forms: library.forms.some((form) => form.id === checked.id)
          ? library.forms.map((form) =>
              form.id === checked.id ? checked : form,
            )
          : [...library.forms, checked],
      });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '表单无效。');
    }
  }
  return (
    <div className="execution-form-settings">
      {draft ? (
        <>
          <header className="approval-editor-header">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => (dirty ? setBack(true) : setDraft(undefined))}
            >
              <ArrowLeft size={16} />
              返回表单列表
            </Button>
            <div className="approval-toolbar-actions">
              <Button variant="outline" onClick={() => setPreview(draft)}>
                预览表单
              </Button>
              <Button disabled={disabled || !dirty} onClick={saveDraft}>
                <Save size={16} />
                保存表单
              </Button>
            </div>
          </header>
          <div className="service-flow-metadata">
            <label className="approval-field">
              <span>表单名称 <RequiredMark /></span>
              <Input
                required
                maxLength={120}
                disabled={disabled}
                value={draft.name}
                onChange={(event) =>
                  change({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label className="approval-field">
              <span>表单说明</span>
              <Input
                maxLength={4000}
                disabled={disabled}
                value={draft.description}
                onChange={(event) =>
                  change({ ...draft, description: event.target.value })
                }
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="sr-error">
              {error}
            </p>
          )}
          <ExecutionFormBuilder
            key={draft.id}
            form={draft}
            disabled={disabled}
            onChange={change}
          />
        </>
      ) : (
        <>
          <div className="submission-rules-toolbar">
            <Input
              className="execution-form-search"
              aria-label="搜索服务步骤表单"
              placeholder="搜索表单名称"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="service-phase-actions">
              <Button
                disabled={disabled}
                onClick={() => {
                  setDraft(newExecutionForm());
                  setDirty(true);
                  setError('');
                }}
              >
                <Plus size={16} />
                创建表单
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="sr-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="submission-rule-notice">
              {notice}
            </p>
          )}
          <div className="table-scroll">
            <table className="reference-table app-list-table">
              <thead>
                <tr>
                  <th>表单名称</th>
                  <th>说明</th>
                  <th>布局字段</th>
                  <th>修改时间</th>
                  <th>修改人</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {library?.forms
                  .filter((form) => form.name.includes(query))
                  .map((form) => (
                    <tr key={form.id}>
                      <td>{form.name}</td>
                      <td>{form.description || '—'}</td>
                      <td>{form.layout.order.length}</td>
                      <td>
                        {form.updatedAt
                          ? new Date(form.updatedAt).toLocaleString('zh-CN', {
                              hour12: false,
                            })
                          : '—'}
                      </td>
                      <td>{form.updatedBy ?? '—'}</td>
                      <td>
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => {
                            const next = structuredClone(form);
                            const unplaced = next.fields.filter(
                              (field) => !next.layout.order.includes(field.id),
                            );
                            next.layout.order.push(
                              ...unplaced.map((field) => field.id),
                            );
                            setDraft(next);
                            setDirty(unplaced.length > 0);
                            setError('');
                          }}
                        >
                          配置表单
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setPreview(form)}
                        >
                          预览
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => {
                            setRemove(form);
                            setError('');
                          }}
                        >
                          删除
                        </Button>
                      </td>
                    </tr>
                  ))}
                {!library?.forms.filter((form) => form.name.includes(query))
                  .length && (
                  <tr>
                    <td colSpan={6} className="routing-empty">
                      {library
                        ? '暂无匹配表单，点击“创建表单”开始配置。'
                        : '正在读取表单…'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      {preview && (
        <ExecutionFormPreview
          form={preview}
          onClose={() => setPreview(undefined)}
        />
      )}
      <Dialog open={back} onOpenChange={setBack}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>放弃未保存的表单修改？</DialogTitle>
            <DialogDescription>返回后将保留上次保存的配置。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBack(false)}>
              继续编辑
            </Button>
            <Button
              onClick={() => {
                setDraft(undefined);
                setDirty(false);
                setBack(false);
                setError('');
              }}
            >
              放弃并返回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={(open) => {
          if (!open && !busy) setRemove(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除表单？</DialogTitle>
            <DialogDescription>
              删除“{remove?.name}”。已被服务步骤引用的表单不可删除。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemove(undefined)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={disabled}
              onClick={() =>
                library &&
                void save({
                  ...library,
                  forms: library.forms.filter((form) => form.id !== remove?.id),
                })
              }
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
