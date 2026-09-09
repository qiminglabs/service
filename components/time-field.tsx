'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { normalizeTime } from '@/lib/time-value';

export function TimeField({
  id,
  label = '时间',
  value,
  onChange,
  readonly = false,
  disabled = false,
  required = false,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  disabled?: boolean;
  required?: boolean;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = normalizeTime(draft)?.split(':') ?? [];
  useEffect(() => {
    if (!open || disabled || readonly) return;
    panelRef.current
      ?.querySelectorAll<HTMLElement>('.sr-time-options')
      .forEach((column) => {
        const checked = column.querySelector<HTMLElement>(
          '[data-selected="true"]',
        );
        if (checked)
          column.scrollTop =
            checked.offsetTop -
            column.clientHeight / 2 +
            checked.offsetHeight / 2;
      });
  }, [open, disabled, readonly]);
  function changeOpen(next: boolean) {
    if (disabled || readonly) return;
    if (next) {
      setDraft(normalizeTime(value) ?? '');
      setError('');
    }
    setOpen(next);
  }
  function commit(next: string) {
    if (disabled || readonly) return;
    onChange(next);
    setOpen(false);
    setError('');
  }
  function confirm() {
    if (disabled || readonly) return;
    const normalized = normalizeTime(draft);
    if (!normalized) {
      setError('请输入有效时间，例如 09:30。');
      return;
    }
    commit(normalized);
  }
  return (
    <div className="sr-service-date-field sr-time-field">
      <label htmlFor={fieldId}>
        <span>
          {label}
          {required && (
            <>
              {' '}
              <em>*</em>
            </>
          )}
        </span>
      </label>
      {readonly ? (
        <Input id={fieldId} value={value || '未填写'} readOnly />
      ) : (
        <Popover open={open && !disabled} onOpenChange={changeOpen}>
          <PopoverTrigger
            id={fieldId}
            disabled={disabled}
            aria-required={required}
            render={<Button type="button" variant="outline" />}
            className="sr-service-date-trigger"
            data-empty={!value || undefined}
          >
            <span>{value || '请选择时间'}</span>
            <Clock3 size={16} aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent
            ref={panelRef}
            align="start"
            className="sr-time-popover"
            aria-label={'选择' + label}
          >
            <Input
              aria-label="直接输入时间"
              type="text"
              inputMode="text"
              placeholder="HH:mm，例如 09:30"
              value={draft}
              disabled={disabled}
              autoComplete="off"
              maxLength={8}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? fieldId + '-error' : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  confirm();
                }
              }}
            />
            <div className="sr-time-columns">
              {(['小时', '分钟'] as const).map((title, index) => (
                <section key={title}>
                  <h4 id={`${fieldId}-${index}-heading`}>{title}</h4>
                  <RadioGroup
                    className="sr-time-options"
                    aria-labelledby={`${fieldId}-${index}-heading`}
                    value={selected[index] ?? ''}
                    disabled={disabled}
                    onValueChange={(next) => {
                      if (disabled || readonly) return;
                      const parts = [selected[0] ?? '00', selected[1] ?? '00'];
                      parts[index] = String(next);
                      setDraft(parts.join(':'));
                      setError('');
                    }}
                  >
                    {Array.from({ length: index === 0 ? 24 : 60 }, (_, n) =>
                      String(n).padStart(2, '0'),
                    ).map((part) => (
                      <label
                        className="sr-time-option"
                        key={part}
                        data-selected={selected[index] === part}
                      >
                        <RadioGroupItem
                          value={part}
                          className="sr-time-choice"
                          aria-label={`${part}${index === 0 ? '时' : '分'}`}
                        />
                        <span aria-hidden="true">{part}</span>
                      </label>
                    ))}
                  </RadioGroup>
                </section>
              ))}
            </div>
            {error && (
              <p id={fieldId + '-error'} className="sr-time-error" role="alert">
                {error}
              </p>
            )}
            <div className="sr-time-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={disabled || (!value && !draft)}
                onClick={() => commit('')}
              >
                清空
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => changeOpen(false)}
              >
                取消
              </Button>
              <Button type="button" disabled={disabled} onClick={confirm}>
                确定
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
