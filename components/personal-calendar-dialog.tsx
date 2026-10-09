'use client';
import { useI18n } from '@/lib/i18n/context';


import { useMemo, useState } from 'react';
import { CalendarDays, Coffee, Moon, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/date-field';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  rangeSlots,
  slotState,
  type CalendarException,
  type PersonalScheduleSnapshot,
} from '@/lib/scheduling';
import type {
  PersonalCalendarAction,
  PersonalCalendarKind,
} from '@/lib/personal-scheduling';

type Props = {
  snapshot: PersonalScheduleSnapshot;
  initialDate: string;
  entry?: CalendarException;
  initialKind: PersonalCalendarKind;
  onClose: () => void;
  onSave: (action: PersonalCalendarAction, revision: number) => Promise<void>;
};

export function PersonalCalendarDialog({
  snapshot,
  initialDate,
  entry,
  initialKind,
  onClose,
  onSave,
}: Props) {
  const { localize } = useI18n();
  const [revision] = useState(snapshot.data.revision);
  const [kind, setKind] = useState<PersonalCalendarKind>(initialKind);
  const [start, setStart] = useState(entry?.start ?? initialDate);
  const [end, setEnd] = useState(entry?.end ?? initialDate);
  const [note, setNote] = useState(entry?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const preview = useMemo(() => {
    try {
      const days = rangeSlots(start, end);
      const person = snapshot.resources[0];
      const conflicts = new Set<string>();
      if (kind === '调休休息' && person) {
        const data = {
          ...snapshot.data,
          exceptions: [
            ...snapshot.data.exceptions.filter((item) => item.id !== entry?.id),
            {
              id: 'preview',
              resourceKey: person.key,
              kind,
              start,
              end,
              note: '',
            },
          ],
        };
        for (const day of days) {
          for (const booking of slotState({ ...snapshot, data }, person, day)
            .bookings)
            conflicts.add(JSON.stringify([booking.projectId, booking.orderId]));
        }
      }
      return { days: days.length, conflicts: conflicts.size };
    } catch {
      return null;
    }
  }, [snapshot, kind, start, end, entry?.id]);
  async function submit(remove = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave(
        remove && entry
          ? { type: 'remove', id: entry.id }
          : { type: 'save', id: entry?.id, kind, start, end, note },
        revision,
      );
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '登记保存失败，请稍后重试。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="eh-calendar-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {localize(removing
              ? '撤销登记'
              : entry
                ? '编辑调休 / 加班'
                : '登记调休 / 加班')}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(removing);
          }}
        >
          <fieldset disabled={busy} className="eh-calendar-form">
            {localize(removing ? (
              <p className="eh-remove-summary">
                {localize("撤销")}{localize(entry?.start)} {localize(" 至")}{localize(entry?.end)} {localize(" 的")}{localize(entry?.kind === '调休休息' ? '调休' : '加班')}{localize("登记？")}</p>
            ) : (
              <>
                <fieldset className="eh-kind-picker" aria-label={localize("登记类型")}>
                  <button
                    type="button"
                    aria-pressed={kind === '调休休息'}
                    onClick={() => setKind('调休休息')}
                  >
                    <Coffee size={18} />
                    {localize("调休")}</button>
                  <button
                    type="button"
                    aria-pressed={kind === '加班上班'}
                    onClick={() => setKind('加班上班')}
                  >
                    <Moon size={18} />
                    {localize("加班")}</button>
                </fieldset>
                <div className="eh-date-pair">
                  <DateField
                    label={localize("开始日期")}
                    required
                    value={start}
                    onChange={setStart}
                    disabled={busy}
                  />
                  <DateField
                    label={localize("结束日期")}
                    required
                    value={end}
                    onChange={setEnd}
                    disabled={busy}
                  />
                </div>
                {localize(preview && (
                  <div className="eh-duration">
                    <CalendarDays size={15} />
                    {localize("全天 · 共")}{localize(preview.days)} {localize(" 天")}</div>
                ))}
                <label className="eh-note-field">
                  {localize("备注")}<textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder={localize("填写事由（选填）")}
                  />
                </label>
                {localize(!!preview?.conflicts && (
                  <output className="eh-conflict">
                    <TriangleAlert size={16} />{localize("与")}{localize(preview.conflicts)}{localize(' ')}
                    {localize("张已排工单重叠，保存后将标记冲突，工单排期保留。")}</output>
                ))}
              </>
            ))}
            {localize(error && (
              <p className="sr-error" role="alert">
                {localize(error)}
              </p>
            ))}
          </fieldset>
          <DialogFooter className="eh-dialog-footer">
            {localize(entry && !removing && (
              <Button
                type="button"
                variant="ghost"
                className="eh-withdraw"
                disabled={busy}
                onClick={() => setRemoving(true)}
              >
                {localize("撤销登记")}</Button>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => (removing ? setRemoving(false) : onClose())}
            >
              {localize("取消")}</Button>
            <Button type="submit" disabled={busy || (!removing && !preview)}>
              {localize(busy ? '保存中…' : removing ? '确认撤销' : '保存登记')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
