'use client';
import { useI18n } from '@/lib/i18n/context';


import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { parseHardwareAssessmentTrigger } from '@/lib/hardware-assessment-trigger';
import {
  canManageRouting,
  saveRoutingPolicy,
} from '@/lib/assessment-routing-store';
import type {
  RoutingConfig,
  RoutingDictionary,
} from '@/lib/assessment-routing-schema';
import type { OperationActor } from '@/lib/request-operations';

export function HardwareAssessmentTriggerSettings({
  actor,
  config,
  services,
  ready,
  onSaved,
}: {
  actor: OperationActor;
  config: RoutingConfig;
  services: RoutingDictionary['services'];
  ready: boolean;
  onSaved: (config: RoutingConfig) => void;
}) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const trigger = parseHardwareAssessmentTrigger(config.hardware.trigger);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [enabled, setEnabled] = useState(trigger.enabled),
    [selected, setSelected] = useState(trigger.serviceIds),
    [search, setSearch] = useState('');
  const original = useRef(config),
    lock = useRef(false);
  const name = (id: string) =>
    services.find((service) => service.id === id)?.name ?? id;
  const missing = selected.filter(
    (id) => !services.some((service) => service.id === id),
  );
  const options = services.filter((service) =>
    `${service.name} ${service.id}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <section className="routing-default" aria-label={localize("硬件评估触发条件")}>
        <div>
          <strong>{localize("触发条件")}</strong>
          <p className="sr-help">
            {localize(trigger.enabled
              ? localizeMessage("服务项包含任一：{0}", [String(localize(localizeList(trigger.serviceIds.map(name), '、')))])
              : '已关闭，不自动增加硬件产品经理评估。')}
          </p>
        </div>
        {localize(canManageRouting(actor) && (
          <Button
            variant="outline"
            disabled={!ready || busy}
            onClick={() => {
              original.current = structuredClone(config);
              setEnabled(trigger.enabled);
              setSelected([...trigger.serviceIds]);
              setSearch('');
              setError('');
              setOpen(true);
            }}
          >
            {localize("配置触发条件")}</Button>
        ))}
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="routing-trigger-dialog">
          <DialogHeader>
            <DialogTitle>{localize("硬件评估触发条件")}</DialogTitle>
          </DialogHeader>
          <label
            htmlFor="hardware-trigger-enabled"
            className="routing-trigger-option"
          >
            <Checkbox
              id="hardware-trigger-enabled"
              checked={enabled}
              onCheckedChange={(checked) => setEnabled(checked === true)}
              disabled={busy}
            />
            {localize("启用硬件产品经理评估")}</label>
          <div className="submission-rule-field">
            <span>{localize("触发服务项")}{localize(enabled && <em> *</em>)}</span>
            <p className="sr-help">
              {localize("申请包含任一所选服务项时，增加硬件产品经理评估。")}</p>
            <Input
              aria-label={localize("搜索触发服务项")}
              placeholder={localize("搜索服务目录")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={busy || !enabled}
            />
            <div className="routing-trigger-options" aria-label={localize("服务目录选项")}>
              {localize([
                ...missing.map((id) => ({ id, name: `${id}（已不存在）` })),
                ...options,
              ].map((service) => (
                <label
                  htmlFor={`hardware-trigger-${service.id}`}
                  className="routing-trigger-option"
                  key={service.id}
                >
                  <Checkbox
                    id={`hardware-trigger-${service.id}`}
                    checked={selected.includes(service.id)}
                    disabled={busy || !enabled}
                    onCheckedChange={(checked) =>
                      setSelected((previous) =>
                        checked
                          ? [
                              ...previous.filter((id) => id !== service.id),
                              service.id,
                            ]
                          : previous.filter((id) => id !== service.id),
                      )
                    }
                  />
                  <span>{localize(service.name)}</span>
                </label>
              )))}
              {localize(!options.length && !missing.length && (
                <p className="sr-help">{localize("没有匹配的服务项。")}</p>
              ))}
            </div>
            <small className="sr-help">
              {localize("已选择")}{localize(selected.length)}{localize(' ')}
              {localize("项。保存后对新提交申请生效；已有请求可在分配预览中应用当前配置。")}</small>
          </div>
          {localize(error && (
            <p className="sr-error" role="alert">
              {localize(error)}
            </p>
          ))}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {localize("取消")}</Button>
            <Button
              disabled={busy || (enabled && !selected.length)}
              onClick={async () => {
                if (lock.current) return;
                lock.current = true;
                setBusy(true);
                setError('');
                try {
                  const updated = await saveRoutingPolicy(
                    actor,
                    'hardware',
                    {
                      ...original.current.hardware,
                      trigger: parseHardwareAssessmentTrigger({
                        enabled,
                        serviceIds: selected,
                      }),
                    },
                    original.current.revision,
                  );
                  onSaved(updated);
                  setOpen(false);
                  window.dispatchEvent(new Event('assessment-routing-saved'));
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : '触发条件保存失败，请重试。',
                  );
                } finally {
                  lock.current = false;
                  setBusy(false);
                }
              }}
            >
              {localize("保存触发条件")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
