'use client';

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
      <section className="routing-default" aria-label="硬件评估触发条件">
        <div>
          <strong>触发条件</strong>
          <p className="sr-help">
            {trigger.enabled
              ? `服务项包含任一：${trigger.serviceIds.map(name).join('、')}`
              : '已关闭，不自动增加硬件产品经理评估。'}
          </p>
        </div>
        {canManageRouting(actor) && (
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
            配置触发条件
          </Button>
        )}
      </section>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="routing-trigger-dialog">
          <DialogHeader>
            <DialogTitle>硬件评估触发条件</DialogTitle>
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
            启用硬件产品经理评估
          </label>
          <div className="submission-rule-field">
            <span>触发服务项{enabled && <em> *</em>}</span>
            <p className="sr-help">
              申请包含任一所选服务项时，增加硬件产品经理评估。
            </p>
            <Input
              aria-label="搜索触发服务项"
              placeholder="搜索服务目录"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={busy || !enabled}
            />
            <div className="routing-trigger-options" aria-label="服务目录选项">
              {[
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
                  <span>{service.name}</span>
                </label>
              ))}
              {!options.length && !missing.length && (
                <p className="sr-help">没有匹配的服务项。</p>
              )}
            </div>
            <small className="sr-help">
              已选择 {selected.length}{' '}
              项。保存后对新提交申请生效；已有请求可在分配预览中应用当前配置。
            </small>
          </div>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
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
              保存触发条件
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
