'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FileText,
  Link,
  Paperclip,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import { saveServiceFlowConfig } from '@/lib/service-flow-store';
import type { ServiceFlow, ServiceFlowConfig } from '@/lib/service-flows';
import {
  maxStepAttachmentBytes,
  moveServiceStep,
  newServiceFlowStep,
  orderedServiceSteps,
  safeStepLink,
  serviceStepTypes,
  type ServiceFlowStep,
  type StepInstruction,
} from '@/lib/service-flow-steps';
import type { OperationActor } from '@/lib/request-operations';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="approval-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function download(material: Extract<StepInstruction, { kind: 'attachment' }>) {
  const url = URL.createObjectURL(material.blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = material.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function ServiceFlowDesigner({
  initialFlow,
  config,
  actor,
  onBack,
  onSaved,
}: {
  initialFlow: ServiceFlow;
  config: ServiceFlowConfig;
  actor: OperationActor;
  onBack: () => void;
  onSaved: (saved: ServiceFlowConfig) => void;
}) {
  const [flow, setFlow] = useState(() => structuredClone(initialFlow));
  const [selected, setSelected] = useState(initialFlow.steps[0]?.id ?? '');
  const [dirty, setDirty] = useState(
    !config.flows.some((row) => row.id === initialFlow.id),
  );
  const [busy, setBusy] = useState(false),
    [confirmBack, setConfirmBack] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  const editable = canManageRouting(actor) && !busy;
  const steps = orderedServiceSteps(flow.steps),
    step = steps.find((row) => row.id === selected);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit(next: ServiceFlow) {
    if (!editable) return;
    setFlow(next);
    setDirty(true);
    setError('');
    setNotice('');
  }
  function update(patch: Partial<ServiceFlowStep>) {
    if (step)
      edit({
        ...flow,
        steps: flow.steps.map((row) =>
          row.id === step.id ? { ...row, ...patch } : row,
        ),
      });
  }
  function add() {
    if (!editable || flow.steps.length >= 100) return;
    const next = newServiceFlowStep(flow.steps.length + 1);
    next.name = `服务步骤 ${next.sequence}`;
    edit({ ...flow, steps: [...steps, next] });
    setSelected(next.id);
  }
  function move(position: number) {
    if (step)
      edit({ ...flow, steps: moveServiceStep(flow.steps, step.id, position) });
  }
  function updateMaterial(next: StepInstruction) {
    if (step)
      update({
        materials: step.materials.map((row) =>
          row.id === next.id ? next : row,
        ),
      });
  }
  function addMaterial(kind: 'text' | 'link') {
    if (!step || step.materials.length >= 30) return;
    const id = crypto.randomUUID();
    update({
      materials: [
        ...step.materials,
        kind === 'text'
          ? { id, kind, content: '' }
          : { id, kind, title: '', url: '' },
      ],
    });
  }
  function attach(files: File[]) {
    if (!step || !editable || !files.length) return;
    if (step.materials.length + files.length > 30) {
      setError('每个步骤最多配置 30 项说明材料。');
      return;
    }
    if (
      files.some((file) => !file.size || file.size > maxStepAttachmentBytes)
    ) {
      setError('说明附件须为非空文件，单个不超过 10 MB。');
      return;
    }
    update({
      materials: [
        ...step.materials,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          kind: 'attachment' as const,
          name: file.name,
          blob: file,
        })),
      ],
    });
  }
  async function save() {
    if (!editable || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const cleaned = {
        ...flow,
        steps: steps.map((row) => ({
          ...row,
          checklist: row.checklist.map((item) => item.trim()).filter(Boolean),
        })),
      };
      const saved = await saveServiceFlowConfig(
        {
          ...config,
          flows: config.flows.some((row) => row.id === flow.id)
            ? config.flows.map((row) => (row.id === flow.id ? cleaned : row))
            : [...config.flows, cleaned],
        },
        actor,
      );
      setFlow(saved.flows.find((row) => row.id === flow.id)!);
      onSaved(saved);
      setDirty(false);
      setNotice('服务流程及步骤配置已保存。');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '保存失败，请重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="approval-settings service-flow-designer">
      <header className="approval-editor-header">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => (dirty ? setConfirmBack(true) : onBack())}
        >
          <ArrowLeft size={16} />
          返回流程列表
        </Button>
        <div className="approval-toolbar-actions">
          <span className="sr-help">{dirty ? '有未保存的修改' : '已保存'}</span>
          <Button disabled={!editable || !dirty} onClick={() => void save()}>
            <Save size={16} />
            {busy ? '正在保存…' : '保存流程'}
          </Button>
        </div>
      </header>
      <div className="service-flow-metadata">
        <Field label="流程名称 *">
          <Input
            aria-label="服务流程名称"
            required
            maxLength={120}
            value={flow.name}
            disabled={!editable}
            onChange={(event) => edit({ ...flow, name: event.target.value })}
          />
        </Field>
        <Field label="流程状态">
          <NativeSelect
            disabled={!editable}
            value={String(flow.enabled)}
            onChange={(event) =>
              edit({ ...flow, enabled: event.target.value === 'true' })
            }
          >
            <option value="true">启用</option>
            <option value="false">停用</option>
          </NativeSelect>
        </Field>
        <Field label="流程说明">
          <Input
            maxLength={4000}
            disabled={!editable}
            value={flow.description}
            onChange={(event) =>
              edit({ ...flow, description: event.target.value })
            }
            placeholder="适用范围和服务目标"
          />
        </Field>
      </div>
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="submission-rule-notice" role="status">
          {notice}
        </p>
      )}
      <div className="approval-designer service-step-designer">
        <section className="approval-canvas" aria-label="服务流程画布">
          <div className="approval-canvas-heading">
            <div>
              <h3>
                服务流程{' '}
                <span>
                  {steps.length} 个步骤 ·{' '}
                  {steps.filter((row) => row.enabled).length} 个启用
                </span>
              </h3>
              <p className="sr-help">
                点击步骤配置内容；停用步骤不参与分配预览。
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!editable || steps.length >= 100}
              onClick={add}
            >
              <Plus size={16} />
              添加服务步骤
            </Button>
          </div>
          <div className="approval-sequence">
            <div className="approval-terminal">服务开始</div>
            {steps.map((item) => (
              <div key={item.id}>
                <div className="approval-connector" aria-hidden="true" />
                <article
                  className={`approval-node service-step-node${selected === item.id ? ' is-selected' : ''}${!item.enabled ? ' is-disabled' : ''}`}
                >
                  <header>
                    <span>
                      步骤 {item.sequence} · {serviceStepTypes[item.type]}
                    </span>
                    <span>{item.enabled ? '启用' : '停用'}</span>
                  </header>
                  <button
                    className="approval-node-content"
                    type="button"
                    aria-pressed={selected === item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <strong>{item.name || '未命名步骤'}</strong>
                    <span>
                      {item.required ? '必须完成' : '可选完成'} ·{' '}
                      {item.deliverToCustomer ? '交付客户' : '内部使用'}
                    </span>
                    {item.materials.length > 0 && (
                      <small>{item.materials.length} 项步骤说明</small>
                    )}
                  </button>
                </article>
              </div>
            ))}
            <div className="approval-connector" aria-hidden="true" />
            <div className="approval-terminal">服务结束</div>
          </div>
        </section>
        <aside
          className="approval-inspector service-step-inspector"
          aria-label="服务步骤设置"
        >
          <h3>步骤设置{step && <small>第 {step.sequence} 步</small>}</h3>
          {step ? (
            <fieldset disabled={!editable} key={step.id}>
              <Field label="名称 *">
                <Input
                  required
                  maxLength={120}
                  value={step.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </Field>
              <div className="service-step-two-fields">
                <Field label="顺序">
                  <NativeSelect
                    value={step.sequence}
                    onChange={(event) => move(Number(event.target.value))}
                  >
                    {steps.map((_, index) => (
                      <option key={index} value={index + 1}>
                        第 {index + 1} 步
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="状态">
                  <NativeSelect
                    value={String(step.enabled)}
                    onChange={(event) =>
                      update({ enabled: event.target.value === 'true' })
                    }
                  >
                    <option value="true">启用</option>
                    <option value="false">停用</option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="service-step-two-fields">
                <Field label="完成要求">
                  <NativeSelect
                    value={String(step.required)}
                    onChange={(event) =>
                      update({ required: event.target.value === 'true' })
                    }
                  >
                    <option value="true">必须完成</option>
                    <option value="false">可选完成</option>
                  </NativeSelect>
                </Field>
                <Field label="是否交付客户">
                  <NativeSelect
                    value={String(step.deliverToCustomer)}
                    onChange={(event) =>
                      update({
                        deliverToCustomer: event.target.value === 'true',
                      })
                    }
                  >
                    <option value="false">否（内部使用）</option>
                    <option value="true">是（交付客户）</option>
                  </NativeSelect>
                </Field>
              </div>
              <Field label="类型">
                <NativeSelect
                  value={step.type}
                  onChange={(event) =>
                    update({
                      type: event.target.value as ServiceFlowStep['type'],
                    })
                  }
                >
                  {Object.entries(serviceStepTypes).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <section className="service-step-section" aria-label="步骤说明">
                <h4>
                  步骤说明 <small>文本、链接、附件可组合添加</small>
                </h4>
                {step.materials.map((material, index) => (
                  <div className="service-step-material" key={material.id}>
                    <div className="service-flow-step-heading">
                      <strong>
                        {index + 1}.{' '}
                        {material.kind === 'text'
                          ? '文本'
                          : material.kind === 'link'
                            ? '链接'
                            : '附件'}
                      </strong>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`删除说明 ${index + 1}`}
                        onClick={() =>
                          update({
                            materials: step.materials.filter(
                              (row) => row.id !== material.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    {material.kind === 'text' && (
                      <Textarea
                        aria-label={`说明 ${index + 1} 文本`}
                        maxLength={10000}
                        rows={3}
                        value={material.content}
                        onChange={(event) =>
                          updateMaterial({
                            ...material,
                            content: event.target.value,
                          })
                        }
                        placeholder="操作指引与注意事项"
                      />
                    )}
                    {material.kind === 'link' && (
                      <>
                        <Input
                          aria-label={`说明 ${index + 1} 链接名称`}
                          maxLength={300}
                          value={material.title}
                          placeholder="链接名称"
                          onChange={(event) =>
                            updateMaterial({
                              ...material,
                              title: event.target.value,
                            })
                          }
                        />
                        <Input
                          aria-label={`说明 ${index + 1} 链接地址`}
                          maxLength={2048}
                          value={material.url}
                          placeholder="https://"
                          onChange={(event) =>
                            updateMaterial({
                              ...material,
                              url: event.target.value,
                            })
                          }
                        />
                        {safeStepLink(material.url) && (
                          <a
                            href={material.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            打开链接
                          </a>
                        )}
                      </>
                    )}
                    {material.kind === 'attachment' && (
                      <div className="service-step-attachment">
                        <Paperclip size={16} />
                        <button
                          type="button"
                          onClick={() => download(material)}
                        >
                          {material.name}
                        </button>
                        <small>
                          {Math.max(1, Math.ceil(material.blob.size / 1024))} KB
                        </small>
                      </div>
                    )}
                  </div>
                ))}
                <div className="routing-inline">
                  <Button
                    variant="outline"
                    disabled={step.materials.length >= 30}
                    onClick={() => addMaterial('text')}
                  >
                    <FileText size={14} />
                    添加文本
                  </Button>
                  <Button
                    variant="outline"
                    disabled={step.materials.length >= 30}
                    onClick={() => addMaterial('link')}
                  >
                    <Link size={14} />
                    添加链接
                  </Button>
                  <Button
                    variant="outline"
                    disabled={step.materials.length >= 30}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip size={14} />
                    上传附件
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    aria-label="上传步骤说明附件"
                    onChange={(event) => {
                      attach(Array.from(event.target.files ?? []));
                      event.target.value = '';
                    }}
                  />
                </div>
                <p className="sr-help">
                  说明附件用于操作参考，单个不超过 10
                  MB；执行时上传的成果按步骤类型配置。
                </p>
              </section>
              <section className="service-step-section" aria-label="类型配置">
                <h4>{serviceStepTypes[step.type]}配置</h4>
                {step.type === 'form' && (
                  <>
                    <p className="sr-help">配置执行人员需要填写的字段。</p>
                    {step.formFields.map((field, index) => (
                      <div className="service-step-material" key={field.id}>
                        <div className="service-flow-step-heading">
                          <strong>字段 {index + 1}</strong>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={step.formFields.length === 1}
                            aria-label={`删除字段 ${index + 1}`}
                            onClick={() =>
                              update({
                                formFields: step.formFields.filter(
                                  (row) => row.id !== field.id,
                                ),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                        <Input
                          aria-label={`字段 ${index + 1} 名称`}
                          value={field.name}
                          maxLength={120}
                          onChange={(event) =>
                            update({
                              formFields: step.formFields.map((row) =>
                                row.id === field.id
                                  ? { ...row, name: event.target.value }
                                  : row,
                              ),
                            })
                          }
                        />
                        <div className="service-step-two-fields">
                          <NativeSelect
                            aria-label={`字段 ${index + 1} 类型`}
                            value={field.type}
                            onChange={(event) =>
                              update({
                                formFields: step.formFields.map((row) =>
                                  row.id === field.id
                                    ? {
                                        ...row,
                                        type: event.target
                                          .value as typeof field.type,
                                      }
                                    : row,
                                ),
                              })
                            }
                          >
                            <option value="text">单行文本</option>
                            <option value="textarea">多行文本</option>
                            <option value="number">数字</option>
                          </NativeSelect>
                          <label className="service-flow-checkbox">
                            <input
                              type="checkbox"
                              checked={field.required}
                              onChange={(event) =>
                                update({
                                  formFields: step.formFields.map((row) =>
                                    row.id === field.id
                                      ? {
                                          ...row,
                                          required: event.target.checked,
                                        }
                                      : row,
                                  ),
                                })
                              }
                            />
                            必填
                          </label>
                        </div>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      disabled={step.formFields.length >= 50}
                      onClick={() =>
                        update({
                          formFields: [
                            ...step.formFields,
                            {
                              id: crypto.randomUUID(),
                              name: '',
                              type: 'text',
                              required: true,
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={14} />
                      添加字段
                    </Button>
                  </>
                )}
                {step.type === 'upload' && (
                  <>
                    <Field label="最少文件数量">
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        step={1}
                        value={
                          Number.isFinite(step.upload.minFiles)
                            ? step.upload.minFiles
                            : ''
                        }
                        onChange={(event) =>
                          update({
                            upload: {
                              ...step.upload,
                              minFiles:
                                event.target.value === ''
                                  ? NaN
                                  : Number(event.target.value),
                            },
                          })
                        }
                      />
                    </Field>
                    <Field label="允许文件格式">
                      <Input
                        maxLength={200}
                        value={step.upload.formats}
                        onChange={(event) =>
                          update({
                            upload: {
                              ...step.upload,
                              formats: event.target.value,
                            },
                          })
                        }
                        placeholder="留空不限制，例如 .pdf,.docx"
                      />
                    </Field>
                  </>
                )}
                {step.type === 'document' && (
                  <Field label="文档模板 / 编写要求">
                    <Textarea
                      rows={6}
                      maxLength={20000}
                      value={step.documentTemplate}
                      onChange={(event) =>
                        update({ documentTemplate: event.target.value })
                      }
                      placeholder={
                        '例如：实施报告\n一、实施范围\n二、执行结果\n三、遗留事项'
                      }
                    />
                  </Field>
                )}
                {(step.type === 'checklist' || step.type === 'combined') && (
                  <Field label="确认清单（每行一项）">
                    <Textarea
                      rows={4}
                      value={step.checklist.join('\n')}
                      onChange={(event) =>
                        update({ checklist: event.target.value.split('\n') })
                      }
                      placeholder="填写需要确认的事项"
                    />
                  </Field>
                )}
                {step.type === 'combined' && (
                  <div className="service-step-legacy">
                    <label className="service-flow-checkbox">
                      <input
                        type="checkbox"
                        checked={step.recordRequired}
                        onChange={(event) =>
                          update({ recordRequired: event.target.checked })
                        }
                      />
                      执行记录必填
                    </label>
                    <label className="service-flow-checkbox">
                      <input
                        type="checkbox"
                        checked={step.attachmentRequired}
                        onChange={(event) =>
                          update({ attachmentRequired: event.target.checked })
                        }
                      />
                      至少上传一份交付物
                    </label>
                  </div>
                )}
              </section>
              <details className="service-step-section">
                <summary>阶段与小标题</summary>
                <Field label="所属阶段">
                  <Input
                    maxLength={120}
                    value={step.phase}
                    onChange={(event) => update({ phase: event.target.value })}
                  />
                </Field>
                <Field label="步骤小标题">
                  <Input
                    maxLength={300}
                    value={step.subtitle}
                    onChange={(event) =>
                      update({ subtitle: event.target.value })
                    }
                  />
                </Field>
              </details>
              <div className="approval-node-actions">
                <Button
                  variant="outline"
                  disabled={step.sequence === 1}
                  onClick={() => move(step.sequence - 1)}
                >
                  <ArrowUp size={14} />
                  上移
                </Button>
                <Button
                  variant="outline"
                  disabled={step.sequence === steps.length}
                  onClick={() => move(step.sequence + 1)}
                >
                  <ArrowDown size={14} />
                  下移
                </Button>
                <Button
                  variant="outline"
                  disabled={steps.length === 1}
                  onClick={() => {
                    const remaining = steps
                      .filter((row) => row.id !== step.id)
                      .map((row, index) => ({ ...row, sequence: index + 1 }));
                    edit({ ...flow, steps: remaining });
                    setSelected(remaining[0]?.id ?? '');
                  }}
                >
                  <Trash2 size={14} />
                  删除步骤
                </Button>
              </div>
            </fieldset>
          ) : (
            <p className="approval-inspector-empty">在左侧选择一个服务步骤。</p>
          )}
        </aside>
      </div>
      <Dialog open={confirmBack} onOpenChange={setConfirmBack}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>返回流程列表？</DialogTitle>
            <DialogDescription>
              当前流程有未保存的修改，返回后将放弃这些修改。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBack(false)}>
              继续编辑
            </Button>
            <Button onClick={onBack}>放弃修改并返回</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
