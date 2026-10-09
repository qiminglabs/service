'use client';
import { useI18n } from '@/lib/i18n/context';


import { RequiredMark } from '@/components/required-mark';

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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ServiceStepFormSelect } from '@/components/service-step-form-select';
import { ServiceStepGeneral } from '@/components/service-step-general';
import { ServiceStepDeliverables } from '@/components/service-step-deliverables';
import { stepDeliverySummary } from '@/lib/service-step-deliverables';
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
  newServiceFlowStep,
  orderedServiceSteps,
  safeStepLink,
  serviceStepTypes,
  type ServiceFlowStep,
  type StepInstruction,
} from '@/lib/service-flow-steps';
import {
arrangeServiceFlow,
removeServiceFlowPhase,
serviceFlowGroups
} from '@/lib/service-flow-phases';
import type { OperationActor } from '@/lib/request-operations';
import { ReportTemplateSettings } from '@/components/report-template-settings';
import {
  withFlowReportTemplates,
  setFlowReportTemplates,
} from '@/lib/flow-report-templates';

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  const { localize } = useI18n();
  return (
    <label className="approval-field">
      <span>{localize(label)}</span>
      {localize(children)}
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
  readonly = false,
}: {
  readonly?: boolean;
  initialFlow: ServiceFlow;
  config: ServiceFlowConfig;
  actor: OperationActor;
  onBack: () => void;
  onSaved: (saved: ServiceFlowConfig) => void;
}) {
  const { localize } = useI18n();
  const [flow, setFlow] = useState(() =>
    readonly
      ? withFlowReportTemplates(initialFlow)
      : arrangeServiceFlow(withFlowReportTemplates(initialFlow)),
  );
  const [tab, setTab] = useState<'steps' | 'templates'>('steps');
  const [selected, setSelected] = useState(initialFlow.steps[0]?.id ?? '');
  const [dirty, setDirty] = useState(
    !readonly &&
      (!config.flows.some((row) => row.id === initialFlow.id) ||
        arrangeServiceFlow(initialFlow).steps.some(
          (row, index) =>
            row.id !== orderedServiceSteps(initialFlow.steps)[index]?.id,
        )),
  );
  const [busy, setBusy] = useState(false),
    [confirmBack, setConfirmBack] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  const editable = !readonly && canManageRouting(actor) && !busy;
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
  const groups = serviceFlowGroups(flow);
  function add(phaseId = '') {
    if (!editable || flow.steps.length >= 100) return;
    const next = newServiceFlowStep(flow.steps.length + 1);
    next.name = `服务步骤 ${next.sequence}`;
    next.phaseId = phaseId;
    edit(arrangeServiceFlow({ ...flow, steps: [...steps, next] }));
    setSelected(next.id);
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
          {localize("返回分配规则")}</Button>
        <div className="approval-toolbar-actions">
          <span className="sr-help">
            {localize(readonly ? '历史配置' : dirty ? '有未保存的修改' : '已保存')}
          </span>
          {localize(!readonly && (
            <Button disabled={!editable || !dirty} onClick={() => void save()}>
              <Save size={16} />
              {localize(busy ? '正在保存…' : '保存流程')}
            </Button>
          ))}
        </div>
      </header>
      <div className="service-flow-metadata">
        <Field label={localize(<>{localize("流程名称")}<RequiredMark /></>)}>
          <Input
            aria-label={localize("服务流程名称")}
            required
            maxLength={120}
            value={flow.name}
            disabled={!editable}
            onChange={(event) => edit({ ...flow, name: event.target.value })}
          />
        </Field>
        <Field label={localize("流程说明")}>
          <Input
            maxLength={4000}
            disabled={!editable}
            value={flow.description}
            onChange={(event) =>
              edit({ ...flow, description: event.target.value })
            }
            placeholder={localize("适用范围和服务目标")}
          />
        </Field>
      </div>
      {localize(error && (
        <p className="sr-error" role="alert">
          {localize(error)}
        </p>
      ))}
      {localize(notice && <output className="submission-rule-notice">{localize(notice)}</output>)}
      <Tabs
        className="sr-ops-tabs flow-report-config"
        value={tab}
        onValueChange={(value) => setTab(value as 'steps' | 'templates')}
      >
        <TabsList
          className="sr-ops-tab-list"
          variant="line"
          aria-label={localize("流程配置")}
        >
          <TabsTrigger value="steps">{localize("服务步骤")}</TabsTrigger>
          <TabsTrigger value="templates">{localize("工单文档模板")}</TabsTrigger>
        </TabsList>
        <TabsContent value="templates">
          <ReportTemplateSettings
            actor={actor}
            flow={flow}
            readonly={!editable}
            onViewStep={(stepId) => { setSelected(stepId); setTab('steps'); }}
            onTemplatesChange={(templates) =>
              edit(setFlowReportTemplates(flow, templates))
            }
          />
        </TabsContent>
        <TabsContent value="steps">
          <div className="approval-designer service-step-designer">
            <section className="approval-canvas" aria-label={localize("服务流程画布")}>
              <div className="approval-canvas-heading">
                <div>
                  <h3>
                    {localize("服务流程")}{localize(' ')}
                    <span>
                      {localize(steps.length)} {localize(" 个步骤 ·")}{localize(' ')}
                      {localize(steps.filter((row) => row.enabled).length)} {localize(" 个启用")}</span>
                  </h3>
                  <p className="sr-help">
                    {localize("点击步骤配置内容；停用步骤不参与分配预览。")}</p>
                </div>
                <div className="service-phase-actions">
                  <Button
                    variant="outline"
                    disabled={!editable || (flow.phases?.length ?? 0) >= 100}
                    onClick={() => {
                      let number = (flow.phases?.length ?? 0) + 1;
                      while (
                        flow.phases?.some(
                          (phase) => phase.name === `阶段 ${number}`,
                        )
                      )
                        number++;
                      edit({
                        ...flow,
                        phases: [
                          ...(flow.phases ?? []),
                          { id: crypto.randomUUID(), name: `阶段 ${number}` },
                        ],
                      });
                    }}
                  >
                    <Plus size={16} />
                    {localize("添加阶段")}</Button>
                  <Button
                    variant="outline"
                    disabled={!editable || steps.length >= 100}
                    onClick={() => add()}
                  >
                    <Plus size={16} />
                    {localize("添加服务步骤")}</Button>
                </div>
              </div>
              <div className="approval-sequence">
                <div className="approval-terminal">{localize("服务开始")}</div>
                {localize(groups
                  .filter((group) => group.id || group.steps.length)
                  .map((group, groupIndex) => (
                    <div
                      className="service-phase-wrapper"
                      key={group.id || 'ungrouped'}
                    >
                      <div className="approval-connector" aria-hidden="true" />
                      <section
                        className={
                          group.id
                            ? 'service-phase-group'
                            : 'service-phase-ungrouped'
                        }
                        aria-label={localize(group.name || '未命名阶段')}
                        data-ungrouped={!group.id}
                      >
                        {localize(group.id && (
                          <header className="service-phase-header">
                            {localize(group.id ? (
                              <Input
                                aria-label={localize(`阶段 ${groupIndex + 1} 名称`)}
                                value={group.name}
                                maxLength={120}
                                disabled={!editable}
                                onChange={(event) =>
                                  edit({
                                    ...flow,
                                    phases: flow.phases?.map((phase) =>
                                      phase.id === group.id
                                        ? { ...phase, name: event.target.value }
                                        : phase,
                                    ),
                                  })
                                }
                              />
                            ) : (
                              <strong>{localize("未分组")}</strong>
                            ))}
                            {localize(editable && (
                              <div className="service-phase-actions">
                                {localize(group.id && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={localize(`上移阶段 ${group.name}`)}
                                      disabled={groupIndex === 0}
                                      onClick={() => {
                                        const phases = [...flow.phases!];
                                        [
                                          phases[groupIndex - 1],
                                          phases[groupIndex],
                                        ] = [
                                          phases[groupIndex],
                                          phases[groupIndex - 1],
                                        ];
                                        edit(
                                          arrangeServiceFlow({
                                            ...flow,
                                            phases,
                                          }),
                                        );
                                      }}
                                    >
                                      <ArrowUp size={14} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={localize(`下移阶段 ${group.name}`)}
                                      disabled={
                                        groupIndex === flow.phases!.length - 1
                                      }
                                      onClick={() => {
                                        const phases = [...flow.phases!];
                                        [
                                          phases[groupIndex + 1],
                                          phases[groupIndex],
                                        ] = [
                                          phases[groupIndex],
                                          phases[groupIndex + 1],
                                        ];
                                        edit(
                                          arrangeServiceFlow({
                                            ...flow,
                                            phases,
                                          }),
                                        );
                                      }}
                                    >
                                      <ArrowDown size={14} />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      aria-label={localize(`删除阶段 ${group.name}，保留步骤`)}
                                      title={localize("删除阶段，步骤保留在未分组中")}
                                      onClick={() =>
                                        edit(
                                          removeServiceFlowPhase(
                                            flow,
                                            group.id,
                                          ),
                                        )
                                      }
                                    >
                                      <Trash2 size={14} />
                                    </Button>
                                  </>
                                ))}
                                <Button
                                  variant="outline"
                                  disabled={steps.length >= 100}
                                  onClick={() => add(group.id)}
                                >
                                  <Plus size={14} />
                                  {localize("添加步骤")}</Button>
                              </div>
                            ))}
                          </header>
                        ))}
                        <div className="service-phase-steps">
                          {localize(!group.steps.length && (
                            <p className="sr-help">
                              {localize("点击“添加步骤”为此阶段配置服务步骤。")}</p>
                          ))}
                          {localize(group.steps.map((item, index) => (
                            <div key={item.id} className="service-phase-step">
                              {localize(index > 0 && (
                                <div
                                  className="approval-connector"
                                  aria-hidden="true"
                                />
                              ))}
                              <article
                                className={`approval-node service-step-node${selected === item.id ? ' is-selected' : ''}${!item.enabled ? ' is-disabled' : ''}`}
                              >
                                <header>
                                  <span>
                                    {localize("步骤")}{localize(item.sequence)} ·{localize(' ')}
                                    {localize(serviceStepTypes[item.type])}
                                  </span>
                                  <span>{localize(item.enabled ? '启用' : '停用')}</span>
                                </header>
                                <button
                                  aria-label={localize(`配置步骤 ${item.name || item.sequence}`)}
                                  className="approval-node-content"
                                  type="button"
                                  aria-pressed={selected === item.id}
                                  onClick={() => setSelected(item.id)}
                                >
                                  <strong>{localize(item.name || '未命名步骤')}</strong>
                                  <span>
                                    {localize(item.required ? '必须完成' : '可选完成')}
                                    {localize(stepDeliverySummary(item) &&
                                      ` · ${stepDeliverySummary(item)}`)}
                                  </span>
                                  {localize(item.materials.length > 0 && (
                                    <small>
                                      {localize(item.materials.length)} {localize(" 项步骤说明")}</small>
                                  ))}
                                </button>
                              </article>
                            </div>
                          )))}
                        </div>
                      </section>
                    </div>
                  )))}
                <div className="approval-connector" aria-hidden="true" />
                <div className="approval-terminal">{localize("服务结束")}</div>
              </div>
            </section>
            <aside
              className="approval-inspector service-step-inspector"
              aria-label={localize("服务步骤设置")}
            >
              <h3>{localize("步骤设置")}{localize(step && <small>{localize("第")}{localize(step.sequence)} {localize(" 步")}</small>)}</h3>
              {localize(step ? (
                <fieldset disabled={!editable} key={step.id}>
                  <Field label={localize(<>{localize("步骤名称")}<RequiredMark /></>)}>
                    <Input
                      aria-label={localize("步骤名称")}
                      required
                      maxLength={120}
                      value={step.name}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                  </Field>
                  <Field label={localize("状态")}>
                    <NativeSelect
                      value={String(step.enabled)}
                      onChange={(event) =>
                        update({ enabled: event.target.value === 'true' })
                      }
                    >
                      <option value="true">{localize("启用")}</option>
                      <option value="false">{localize("停用")}</option>
                    </NativeSelect>
                  </Field>
                  <Field label={localize("完成要求")}>
                    <NativeSelect
                      value={String(step.required)}
                      onChange={(event) =>
                        update({ required: event.target.value === 'true' })
                      }
                    >
                      <option value="true">{localize("必须完成")}</option>
                      <option value="false">{localize("可选完成")}</option>
                    </NativeSelect>
                  </Field>
                  <Field label={localize("类型")}>
                    <NativeSelect
                      value={step.type}
                      onChange={(event) =>
                        update({
                          type: event.target.value as ServiceFlowStep['type'],
                          ...(event.target.value === 'combined'
                            ? { deliverToCustomer: false }
                            : {}),
                        })
                      }
                    >
                      {localize(Object.entries(serviceStepTypes).map(
                        ([value, label]) => (
                          <option key={value} value={value}>
                            {localize(label)}
                          </option>
                        ),
                      ))}
                    </NativeSelect>
                  </Field>
                  <section
                    className="service-step-section"
                    aria-label={localize("步骤说明")}
                  >
                    <h4>
                      {localize("步骤说明")}<small>{localize("文本、链接、附件可组合添加")}</small>
                    </h4>
                    {localize(step.materials.map((material, index) => (
                      <div className="service-step-material" key={material.id}>
                        <div className="service-flow-step-heading">
                          <strong>
                            {localize(index + 1)}.{localize(' ')}
                            {localize(material.kind === 'text'
                              ? '文本'
                              : material.kind === 'link'
                                ? '链接'
                                : '附件')}
                          </strong>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={localize(`删除说明 ${index + 1}`)}
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
                        {localize(material.kind === 'text' && (
                          <Textarea
                            aria-label={localize(`说明 ${index + 1} 文本`)}
                            maxLength={10000}
                            rows={3}
                            value={material.content}
                            onChange={(event) =>
                              updateMaterial({
                                ...material,
                                content: event.target.value,
                              })
                            }
                            placeholder={localize("操作指引与注意事项")}
                          />
                        ))}
                        {localize(material.kind === 'link' && (
                          <>
                            <Input
                              aria-label={localize(`说明 ${index + 1} 链接名称`)}
                              maxLength={300}
                              value={material.title}
                              placeholder={localize("链接名称")}
                              onChange={(event) =>
                                updateMaterial({
                                  ...material,
                                  title: event.target.value,
                                })
                              }
                            />
                            <Input
                              aria-label={localize(`说明 ${index + 1} 链接地址`)}
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
                            {localize(safeStepLink(material.url) && (
                              <a
                                href={material.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {localize("打开链接")}</a>
                            ))}
                          </>
                        ))}
                        {localize(material.kind === 'attachment' && (
                          <div className="service-step-attachment">
                            <Paperclip size={16} />
                            <button
                              type="button"
                              onClick={() => download(material)}
                            >
                              {localize(material.name)}
                            </button>
                            <small>
                              {localize(Math.max(
                                1,
                                Math.ceil(material.blob.size / 1024),
                              ))}{localize(' ')}
                              KB
                            </small>
                          </div>
                        ))}
                      </div>
                    )))}
                    <div className="routing-inline">
                      <Button
                        variant="outline"
                        disabled={step.materials.length >= 30}
                        onClick={() => addMaterial('text')}
                      >
                        <FileText size={14} />
                        {localize("添加文本")}</Button>
                      <Button
                        variant="outline"
                        disabled={step.materials.length >= 30}
                        onClick={() => addMaterial('link')}
                      >
                        <Link size={14} />
                        {localize("添加链接")}</Button>
                      <Button
                        variant="outline"
                        disabled={step.materials.length >= 30}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip size={14} />
                        {localize("上传附件")}</Button>
                      <input
                        ref={fileInput}
                        type="file"
                        multiple
                        hidden
                        aria-label={localize("上传步骤说明附件")}
                        onChange={(event) => {
                          attach(Array.from(event.target.files ?? []));
                          event.target.value = '';
                        }}
                      />
                    </div>
                    <p className="sr-help">
                      {localize("说明附件用于操作参考，单个不超过 10 MB；执行时上传的成果按步骤类型配置。")}</p>
                  </section>
                  <section
                    className="service-step-section"
                    aria-label={localize("类型配置")}
                  >
                    <h4>{localize(serviceStepTypes[step.type])}{localize("配置")}</h4>
                    {localize(step.type === 'form' && (
                      <ServiceStepFormSelect
                        key={step.id}
                        step={step}
                        editable={editable}
                        onChange={update}
                      />
                    ))}
                    {localize((step.type === 'document' || step.type === 'upload') && (
                      <ServiceStepDeliverables
                        steps={flow.steps}
                        reportTemplates={flow.reportTemplates ?? []}
                        onManageTemplates={() => setTab('templates')}
                        key={`${step.id}:${step.type}`}
                        step={step}
                        editable={editable}
                        onChange={update}
                      />
                    ))}
                    {localize(step.type === 'combined' && (
                      <ServiceStepGeneral
                        key={step.id}
                        step={step}
                        editable={editable}
                        onChange={update}
                      />
                    ))}
                  </section>
                  <div className="approval-node-actions">
                    <Button
                      variant="outline"
                      disabled={steps.length === 1}
                      onClick={() => {
                        const remaining = steps
                          .filter((row) => row.id !== step.id)
                          .map((row, index) => ({
                            ...row,
                            sequence: index + 1,
                          }));
                        edit({ ...flow, steps: remaining });
                        setSelected(remaining[0]?.id ?? '');
                      }}
                    >
                      <Trash2 size={14} />
                      {localize("删除步骤")}</Button>
                  </div>
                </fieldset>
              ) : (
                <p className="approval-inspector-empty">
                  {localize("在左侧选择一个服务步骤。")}</p>
              ))}
            </aside>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={confirmBack} onOpenChange={setConfirmBack}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{localize("返回分配规则？")}</DialogTitle>
            <DialogDescription>
              {localize("当前流程有未保存的修改，返回后将放弃这些修改。")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBack(false)}>
              {localize("继续编辑")}</Button>
            <Button onClick={onBack}>{localize("放弃修改并返回")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
