'use client';
import { useI18n } from '@/lib/i18n/context';


import { RequiredMark } from '@/components/required-mark';

import { useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import {
  serviceAvailableForRequest,
  type CatalogService,
  type RequestItem,
} from '@/lib/service-requests';
import { projectItemAudience } from '@/lib/service-projects';
import {
  newProjectServiceItem,
  readProjectItemContext,
} from '@/lib/service-project-store';
import { type ProjectItemContext } from '@/lib/service-project-items';
import { ProjectItemBasicFields } from '@/components/service-project-items';
import { canPauseProjectWorkOrder, canResumeProjectWorkOrder } from '@/lib/service-work-orders';
import type { ServiceWorkOrder } from '@/lib/service-work-orders';
import {
  canChangeProjectWorkOrders,
  canSubmitProjectReview,
  canReturnProjectReview,
  projectReviewIssue,
} from '@/lib/service-project-work-order-policy';
import {
  addStoredProjectWorkOrder,
  cancelStoredProjectWorkOrder,
  saveStoredWorkOrderSuspension,
  submitStoredProjectReview,
  returnStoredProjectReview,
} from '@/lib/service-work-order-store';

type Props = {
  project: ServiceProjectRecord;
  actor: OperationActor;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void;
};
export function WorkOrderChangeAction({
  project,
  actor,
  busy,
  onBusy,
  onSaved,
  order,
  services = [],
  compact = false,
}: Props & { order?: ServiceWorkOrder; services?: CatalogService[]; compact?: boolean }) {
  const { localize } = useI18n();
  const [open, setOpen] = useState(false);
  const [serviceId, setServiceId] = useState('');
  const [choosing, setChoosing] = useState(true);
  const [query, setQuery] = useState('');
  const [item, setItem] = useState<RequestItem | null>(null);
  const [context, setContext] = useState<ProjectItemContext | null>(null);
  const [loading, setLoading] = useState(false);
  const loadVersion = useRef(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  if (!canChangeProjectWorkOrders(project, actor) || order?.status === '已取消')
    return null;
  const options = (context?.services ?? services).filter((service) =>
    serviceAvailableForRequest(service, projectItemAudience(actor)),
  );
  const service = options.find((service) => service.id === serviceId);
  const matches = options.filter((service) =>
    `${service.name} ${service.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  async function selectService(selectedService: CatalogService) {
    if (loading || saving) return;
    if (item && selectedService.id === serviceId) {
      setChoosing(false);
      setError('');
      return;
    }
    const version = ++loadVersion.current;
    setLoading(true);
    setError('');
    try {
      const nextContext = await readProjectItemContext();
      const selected = nextContext.services.find(
        (service) => service.id === selectedService.id,
      );
      if (!selected) throw new Error('服务目录不存在，请重新选择。');
      const nextItem = await newProjectServiceItem(selected, actor, {
        formOnly: true,
      });
      if (version !== loadVersion.current) return;
      setContext(nextContext);
      setServiceId(selected.id);
      setItem(nextItem);
      setChoosing(false);
    } catch (cause) {
      if (version === loadVersion.current)
        setError(cause instanceof Error ? cause.message : '读取表单失败。');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  async function submit() {
    if (lock.current || (!order && (!item || loading || choosing))) return;
    lock.current = true;
    setSaving(true);
    onBusy(true);
    setError('');
    try {
      const result = order
        ? await cancelStoredProjectWorkOrder(
            project.id,
            project.revision,
            actor,
            order.id,
            reason,
          )
        : await addStoredProjectWorkOrder(project.id, project.revision, actor, {
            item: item!,
          });
      onSaved(result);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
    } finally {
      lock.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size={order ? 'sm' : 'default'}
        disabled={busy}
        onClick={() => {
          setOpen(true);
          setError('');
          setReason('');
          setServiceId('');
          setChoosing(true);
          setQuery('');
          setItem(null);
          setContext(null);
          setLoading(false);
          loadVersion.current += 1;
        }}
      >
        {localize(order ? compact ? '取消' : '取消工单' : '新建工单')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) {
            setOpen(value);
            if (!value) loadVersion.current += 1;
          }
        }}
      >
        <DialogContent
          className={
            order
              ? undefined
              : 'sr-dialog sr-catalog-dialog sr-item-basics-dialog'
          }
          showCloseButton={!saving}
        >
          <DialogHeader>
            <DialogTitle>{localize(order ? '取消工单' : '新建工单')}</DialogTitle>
            {localize(order && <DialogDescription>{localize("取消后不可恢复，已录入的执行记录将保留。")}</DialogDescription>)}
            {localize(!order && (
              <DialogDescription>
                {localize(choosing ? '选择服务目录' : '填写工单信息')}
              </DialogDescription>
            ))}
          </DialogHeader>
          {localize(order ? (
            <div className="wo-assignment-form wo-change-form">
              <p>
                {localize(order.item.serviceName)} · {localize(order.id)}
              </p>
              <label>
                {localize("取消原因")}<em>*</em>
                <Textarea
                  aria-label={localize("取消原因")}
                  required
                  maxLength={2000}
                  value={reason}
                  disabled={saving}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className="sr-item-dialog-body">
              {localize(choosing ? (
                <>
                  <Input
                    aria-label={localize("搜索可创建工单的服务目录")}
                    placeholder={localize("搜索服务名称或编码")}
                    value={query}
                    disabled={loading || saving}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <div className="sr-catalog-options">
                    {localize(matches.map((service) => (
                      <div key={service.id}>
                        <FileText size={20} aria-hidden="true" />
                        <div>
                          <strong>{localize(service.name)}</strong>
                          <p>
                            {localize(service.id)} · {localize(service.category)}
                          </p>
                          {localize(service.description?.trim() && (
                            <p className="sr-catalog-service-description">
                              {localize(service.description)}
                            </p>
                          ))}
                        </div>
                        <Button
                          variant="outline"
                          disabled={loading || saving}
                          onClick={() => void selectService(service)}
                        >
                          {localize("选择")}</Button>
                      </div>
                    )))}
                    {localize(!matches.length && (
                      <p className="sr-empty">{localize("没有匹配的已启用服务。")}</p>
                    ))}
                  </div>
                  {localize(loading && <output>{localize("加载中…")}</output>)}
                </>
              ) : (
                item &&
                context && (
                  <>
                    <div className="sr-selected-service">
                      <div>
                        <div className="sr-selected-service-heading">
                          <strong>{localize(item.serviceName)}</strong>
                          <p>
                            {localize(item.serviceId)} {localize(" · 版本 v")}{localize(service?.version ?? 1)}
                          </p>
                        </div>
                        {localize(service?.description?.trim() && (
                          <p className="sr-selected-service-content">
                            {localize("服务内容：")}{localize(service.description)}
                          </p>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        disabled={saving}
                        onClick={() => {
                          setChoosing(true);
                          setError('');
                        }}
                      >
                        {localize("重新选择目录")}</Button>
                    </div>
                    <ProjectItemBasicFields
                      value={item}
                      objects={context.businessObjects.filter(
                        (object) => object.customerId === project.customerId,
                      )}
                      customerId={project.customerId}
                      reservationRecords={context.requests}
                      priceUnit={service?.priceUnit}
                      readonly={false}
                      busy={saving}
                      lockedFields={[]}
                      descriptionPlaceholder="说明本项服务的目标、范围和期望结果。"
                      update={(patch) =>
                        setItem((current) =>
                          current ? { ...current, ...patch } : current,
                        )
                      }
                    />
                  </>
                )
              ))}
            </div>
          ))}
          {localize(error && (
            <p className="sr-error" role="alert">
              {localize(error)}
            </p>
          ))}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => {
                setOpen(false);
                loadVersion.current += 1;
              }}
            >
              {localize(order ? '返回' : '取消')}
            </Button>
            {localize((order || !choosing) && (
              <Button
                disabled={saving || loading || (order ? !reason.trim() : !item)}
                onClick={() => void submit()}
              >
                {localize(saving ? '保存中…' : order ? '确认取消' : '创建工单')}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function SubmitProjectReviewButton(
  props: Props & { beforeSubmit?: () => boolean; onValidationError: (message: string) => void },
) {
  const { localize } = useI18n();
  const lock = useRef(false);
  if (!canSubmitProjectReview(props.project, props.actor)) return null;
  const issue = projectReviewIssue(props.project);
  return (
      <Button
        disabled={props.busy || !!issue}
        title={localize(issue ?? undefined)}
        onClick={async () => {
          if (lock.current) return;
          props.onValidationError('');
          if (props.beforeSubmit && !props.beforeSubmit()) {
            props.onValidationError('请先保存当前工单步骤，再提交复核。');
            return;
          }
          lock.current = true;
          props.onBusy(true);
          try {
            props.onSaved(
              await submitStoredProjectReview(
                props.project.id,
                props.project.revision,
                props.actor,
              ),
            );
          } catch (cause) {
            props.onValidationError(
              cause instanceof Error ? cause.message : '提交失败，请重试。',
            );
          } finally {
            lock.current = false;
            props.onBusy(false);
          }
        }}
      >
        {localize("提交复核")}</Button>
  );
}

export function ReturnProjectReviewButton(props: Props) {
  const { localize } = useI18n();
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [error, setError] = useState('');
  const lock = useRef(false);
  if (!canReturnProjectReview(props.project, props.actor)) return null;
  async function submit() {
    if (lock.current || props.busy) return;
    lock.current = true; props.onBusy(true); setError('');
    try {
      const result = await returnStoredProjectReview(props.project.id, props.project.revision, props.actor, { reason });
      props.onSaved(result); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '退回失败，请重试。'); }
    finally { lock.current = false; props.onBusy(false); }
  }
  return <>
    <Button variant="outline" disabled={props.busy} onClick={() => { setOpen(true); setReason(''); setError(''); }}>{localize("退回执行")}</Button>
    <Dialog open={open} onOpenChange={value => { if (!props.busy) setOpen(value); }}><DialogContent showCloseButton={!props.busy}>
      <DialogHeader><DialogTitle>{localize("退回执行")}</DialogTitle><DialogDescription>{localize(props.project.name)}</DialogDescription></DialogHeader>
      <div className="sr-ops-form">
        <label className="sr-ops-field"><span>{localize("退回原因")}<RequiredMark /></span><Textarea aria-label={localize("退回原因")} required maxLength={2000} disabled={props.busy} value={reason} onChange={event => setReason(event.target.value)} /></label>
        {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
      </div>
      <DialogFooter><Button variant="outline" disabled={props.busy} onClick={() => setOpen(false)}>{localize("取消")}</Button><Button disabled={props.busy || !reason.trim()} onClick={() => void submit()}>{localize("确认退回")}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

export function WorkOrderSuspensionAction(props: Props & { order: ServiceWorkOrder }) {
  const { localize } = useI18n();
  const lock = useRef(false);
  const [error, setError] = useState('');
  const resume = props.order.status === '已暂停';
  const allowed = resume ? canResumeProjectWorkOrder(props.project, props.actor, props.order) : canPauseProjectWorkOrder(props.project, props.actor, props.order);
  if (!allowed) return null;
  async function save() {
    if (lock.current || props.busy) return;
    lock.current = true; props.onBusy(true); setError('');
    try {
      props.onSaved(await saveStoredWorkOrderSuspension(props.project.id, props.project.revision, props.actor, props.order.id, resume ? 'resume' : 'pause'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { lock.current = false; props.onBusy(false); }
  }
  return <><Button variant="outline" size="sm" disabled={props.busy} onClick={() => void save()}>{localize(resume ? '恢复' : '暂停')}</Button>{localize(error && <span className="sr-error" role="alert">{localize(error)}</span>)}</>;
}
