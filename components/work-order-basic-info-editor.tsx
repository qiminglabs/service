'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { ProjectCollaboratorDirectory } from '@/lib/service-project-collaborators';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { DateField } from '@/components/date-field';
import { WorkOrderFormFields } from '@/components/work-order-form-fields';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { ServiceWorkOrder } from '@/lib/service-work-orders';
import type { OperationActor } from '@/lib/request-operations';
import {
  canEditWorkOrderBasicInfo,
  workOrderContactOptions,
  type WorkOrderBasicInfoInput,
} from '@/lib/work-order-basic-info';
import { saveStoredWorkOrderBasicInfo } from '@/lib/service-work-order-store';

export function WorkOrderBasicInfoEditor({
  directory,
  project,
  order,
  actor,
  busy,
  onBusy,
  onSaved,
}: {
  directory: ProjectCollaboratorDirectory;
  project: ServiceProjectRecord;
  order: ServiceWorkOrder;
  actor: OperationActor;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void;
}) {
  const [draft, setDraft] = useState<WorkOrderBasicInfoInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  if (!canEditWorkOrderBasicInfo(project, order, actor)) return null;
  const contacts = workOrderContactOptions(project, directory);
  const contactKey = (contact: { id: string; group: string }) =>
    `${contact.group}:${contact.id}`;
  const selectedContact = draft?.contact
    ? contacts.find(
        (person) => contactKey(person) === contactKey(draft.contact!),
      )
    : undefined;
  const selection = draft?.contact
    ? contactKey(draft.contact)
    : draft?.contact === undefined && order.contactName
      ? 'stored'
      : 'none';
  const phone =
    draft?.contact === undefined
      ? (order.contactPhone ?? '')
      : (selectedContact?.phone ?? '');
  const update = (patch: Partial<WorkOrderBasicInfoInput>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  async function save() {
    if (!draft || lock.current) return;
    lock.current = true;
    setSaving(true);
    onBusy(true);
    setError('');
    try {
      const saved = await saveStoredWorkOrderBasicInfo(
        project.id,
        project.revision,
        actor,
        draft,
      );
      onSaved(saved);
      setDraft(null);
      setNotice('基本信息已保存。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      lock.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  return (
    <div className="wo-basic-actions">
      {notice && <output>{notice}</output>}
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          setDraft({
            orderId: order.id,
            expectedServiceDate: order.expectedServiceDate,
            plannedCompletionDate: order.plannedCompletionDate ?? '',
            values: Object.fromEntries(order.item.config.fields.filter(id => !['method', 'description', 'businessObjects'].includes(id)).map(id => [id, order.item.values[id] ?? ''])),
            method: order.item.method,
            description: order.item.description ?? '',
            contact: order.contactRef ?? (order.contactName ? undefined : null),
          });
          setError('');
          setNotice('');
        }}
      >
        编辑基本信息
      </Button>
      <Dialog
        open={!!draft}
        onOpenChange={(open) => {
          if (!open && !saving) setDraft(null);
        }}
      >
        <DialogContent
          className="sr-dialog sr-item-basics-dialog"
          showCloseButton={!saving}
        >
          <DialogHeader>
            <DialogTitle>编辑基本信息</DialogTitle>
            <DialogDescription>
              {order.item.serviceName} · {order.id}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="sr-item-dialog-body wo-basic-edit-form">
              <div className="wo-basic-edit-dates">
                <DateField
                  id="wo-basic-start"
                  label="计划执行日期"
                  required
                  value={draft.expectedServiceDate}
                  disabled={saving}
                  onChange={(expectedServiceDate) =>
                    update({ expectedServiceDate })
                  }
                />
                <DateField
                  id="wo-basic-end"
                  label="计划完成日期"
                  required
                  value={draft.plannedCompletionDate}
                  disabled={saving}
                  onChange={(plannedCompletionDate) =>
                    update({ plannedCompletionDate })
                  }
                />
              </div>
              <WorkOrderFormFields
                item={{ ...order.item, method: draft.method ?? order.item.method, values: draft.values ?? order.item.values, description: draft.description }}
                disabled={saving}
                onChange={patch => update(patch)}
              />
              <div className="wo-basic-edit-dates">
                <div className="wo-basic-contact-select">
                  <label htmlFor="wo-basic-contact">现场联系人</label>
                  <Select
                    value={selection}
                    disabled={saving}
                    onValueChange={(key) => {
                      if (!key || key === 'stored') return;
                      const person = contacts.find(
                        (person) => contactKey(person) === key,
                      );
                      update({
                        contact: person
                          ? { id: person.id, group: person.group }
                          : null,
                      });
                    }}
                  >
                    <SelectTrigger id="wo-basic-contact">
                      {selectedContact?.name ??
                        (selection === 'stored'
                          ? `${order.contactName}（原记录）`
                          : draft.contact
                            ? `${order.contactName || '原联系人'}（不可用）`
                            : '请选择协作人')}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">不指定</SelectItem>
                      {selection === 'stored' && (
                        <SelectItem value="stored" disabled>
                          {order.contactName}（原记录）
                        </SelectItem>
                      )}
                      {draft.contact && !selectedContact && (
                        <SelectItem value={selection} disabled>
                          {order.contactName || '原联系人'}（不可用）
                        </SelectItem>
                      )}
                      {contacts.map((person) => (
                        <SelectItem
                          key={contactKey(person)}
                          value={contactKey(person)}
                        >
                          {person.name} ·{' '}
                          {
                            {
                              customer: '客户协作人',
                              internal: '内部协作人',
                              partner: '合作伙伴协作人',
                            }[person.group]
                          }
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!contacts.length && (
                    <p className="sr-help">暂无可选协作人</p>
                  )}
                </div>
                <label htmlFor="wo-basic-phone">
                  联系电话
                  <Input
                    id="wo-basic-phone"
                    value={phone}
                    readOnly
                    placeholder="未填写"
                  />
                </label>
              </div>
            </div>
          )}
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              取消
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
