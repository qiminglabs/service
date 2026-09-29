'use client';

import { useEffect, useRef, useState } from 'react';
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
import { updateLocalReference } from '@/lib/service-requests';
import {
  entitlementNames,
  ensureConversionHistory,
  parseConversionDays,
  appendConversionVersion,
  type EntitlementKind,
  type ConversionVersion,
} from '@/lib/entitlement-conversions';

const recordId = (kind: EntitlementKind) => `entitlement-conversion-${kind}`;
const dateLabel = (date: string) =>
  new Date(date).toLocaleString('zh-CN', { hour12: false });
export function EntitlementConversions({ actor }: { actor: string }) {
  const [histories, setHistories] = useState<
    Record<EntitlementKind, ConversionVersion[]>
  >({ inspection: [], upgrade: [] });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<EntitlementKind | null>(null);
  const [historyKind, setHistoryKind] = useState<EntitlementKind | null>(null);
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const saveLock = useRef(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      updateLocalReference<ConversionVersion[]>(
        recordId('inspection'),
        ensureConversionHistory,
      ),
      updateLocalReference<ConversionVersion[]>(
        recordId('upgrade'),
        ensureConversionHistory,
      ),
    ])
      .then(([inspection, upgrade]) => {
        if (!active) return;
        setHistories({ inspection, upgrade });
        setReady(true);
      })
      .catch(() => {
        if (active) setError('无法读取权益换算配置，请刷新后重试。');
      });
    return () => {
      active = false;
    };
  }, []);
  function edit(kind: EntitlementKind) {
    setEditing(kind);
    setDays(String(histories[kind].at(-1)?.days ?? ''));
    setNote('');
    setFormError('');
  }
  async function save() {
    if (!editing || !ready || saveLock.current) return;
    const parsed = parseConversionDays(days);
    if (parsed === null) {
      setFormError('请输入大于 0、不超过 1000000 的人天数，最多一位小数。');
      return;
    }
    saveLock.current = true;
    setBusy(true);
    setFormError('');
    try {
      const next = await updateLocalReference<ConversionVersion[]>(
        recordId(editing),
        (current) =>
          appendConversionVersion(
            ensureConversionHistory(current),
            parsed,
            actor,
            note,
          ),
      );
      setHistories((previous) => ({ ...previous, [editing]: next }));
      setNotice(
        `${entitlementNames[editing]}已保存为 V${next.at(-1)!.version}`,
      );
      setEditing(null);
    } catch (issue) {
      setFormError(
        issue instanceof Error && issue.message.includes('未变化')
          ? issue.message
          : '保存失败，请检查本机存储后重试。当前修改仍保留。',
      );
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="entitlement-conversions">
      <p className="sr-help entitlement-conversion-help">
        指当权益不足时，补足权益需购买的人天数。
      </p>
      {error && (
        <p role="alert" className="sr-error">
          {error}
        </p>
      )}
      {notice && <output className="sr-help">{notice}</output>}
      <div className="table-scroll">
        <table className="reference-table app-list-table">
          <thead>
            <tr>
              <th>权益类型</th>
              <th>换算系数</th>
              <th>当前版本</th>
              <th>修改时间</th>
              <th>修改人</th>
              <th data-list-actions>操作</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(entitlementNames) as EntitlementKind[]).map(
              (kind) => {
                const current = histories[kind].at(-1);
                return (
                  <tr key={kind}>
                    <td>
                      <strong>{entitlementNames[kind]}</strong>
                    </td>
                    <td>
                      {current ? `1 次 = ${current.days} 人天` : '未配置'}
                    </td>
                    <td>{current ? `V${current.version}` : '—'}</td>
                    <td>{current ? dateLabel(current.updatedAt) : '—'}</td>
                    <td>{current?.updatedBy ?? '—'}</td>
                    <td>
                      <Button
                        variant="ghost"
                        disabled={!ready}
                        onClick={() => edit(kind)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={!current}
                        onClick={() => setHistoryKind(kind)}
                      >
                        历史版本
                      </Button>
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
      {!ready && !error && <p className="sr-help">正在读取配置…</p>}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(null);
        }}
      >
        <DialogContent className="request-field-dialog">
          <DialogHeader>
            <DialogTitle>
              编辑{editing ? entitlementNames[editing] : ''}换算系数
            </DialogTitle>
            <DialogDescription>
              保存将生成新版本，历史版本不会被覆盖。
            </DialogDescription>
          </DialogHeader>
          <form
            className="sr-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label className="sr-span" htmlFor="conversion-days">
              1 次权益折合人天数
              <Input
                id="conversion-days"
                type="number"
                min="0.1"
                max="1000000"
                step="0.1"
                required
                disabled={busy}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                placeholder="请输入换算系数"
              />
            </label>
            <label className="sr-span">
              修改备注（选填）
              <textarea
                rows={3}
                maxLength={500}
                disabled={busy}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="记录本次调整原因"
              />
            </label>
            {formError && (
              <p role="alert" className="sr-error sr-span">
                {formError}
              </p>
            )}
            <DialogFooter className="sr-span">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? '正在保存…' : '保存新版本'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={historyKind !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryKind(null);
        }}
      >
        <DialogContent className="request-field-dialog">
          <DialogHeader>
            <DialogTitle>
              {historyKind ? entitlementNames[historyKind] : ''}历史版本
            </DialogTitle>
            <DialogDescription>
              按修改时间倒序展示，最新版本为当前配置。
            </DialogDescription>
          </DialogHeader>
          <div className="entitlement-history">
            {historyKind &&
              [...histories[historyKind]].reverse().map((version, index) => (
                <article
                  key={version.id}
                  className="entitlement-history-version"
                >
                  <div>
                    <strong>
                      V{version.version}
                      {index === 0 ? ' · 当前版本' : ''}
                    </strong>
                    <strong>1 次 = {version.days} 人天</strong>
                  </div>
                  <p>
                    {dateLabel(version.updatedAt)} · {version.updatedBy}
                  </p>
                  <p>{version.note || '无修改备注'}</p>
                </article>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
