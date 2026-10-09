'use client';
import { useI18n } from '@/lib/i18n/context';


import { useId, useState } from 'react';
import { format, isValid, parseISO } from 'date-fns';
import { zhCN, enUS } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function DateField({
  id,
  label = '日期',
  value,
  onChange,
  readonly = false,
  disabled = false,
  required = false,
  hideLabel = false,
  uncertain = false,
  onUncertain,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  readonly?: boolean;
  disabled?: boolean;
  required?: boolean;
  hideLabel?: boolean;
  uncertain?: boolean;
  onUncertain?: () => void;
}) {
  const { localize, locale, localizeMessage } = useI18n();
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const parsed = value ? parseISO(value) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  function choose(date?: Date) {
    if (readonly || disabled) return;
    onChange(date ? format(date, 'yyyy-MM-dd') : '');
    setOpen(false);
  }

  return (
    <div className="sr-service-date-field">
      <label htmlFor={fieldId} className={hideLabel ? 'sr-only' : undefined}>
        <span>
          {localize(label)}
          {localize(required ? (
            <>
              {localize(' ')}
              <em>*</em>
            </>
          ) : null)}
        </span>
      </label>
      {localize(readonly ? (
        <Input id={fieldId} value={localize(uncertain ? '暂不确定' : value || '未填写')} readOnly />
      ) : (
        <Popover open={open && !disabled} onOpenChange={setOpen}>
          <PopoverTrigger
            id={fieldId}
            disabled={disabled}
            render={<Button type="button" variant="outline" />}
            className="sr-service-date-trigger"
            data-empty={(!value && !uncertain) || undefined}
          >
            <span>{localize(uncertain ? '暂不确定' : value || '请选择日期')}</span>
            <CalendarDays size={16} aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="sr-service-date-popover"
            aria-label={localize(localizeMessage("选择{0}", [String(localize(label))]))}
          >
            <Calendar
              mode="single"
              required
              locale={locale === 'en' ? enUS : zhCN}
              selected={selected}
              defaultMonth={selected}
              onSelect={choose}
            />
            <div className="sr-service-date-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => choose(new Date())}
              >
                {localize("今天")}</Button>
              <Button
                type="button"
                variant="ghost"
                disabled={!value && !uncertain}
                onClick={() => choose()}
              >
                {localize("清空")}</Button>
              {localize(onUncertain && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { onUncertain(); setOpen(false); }}
                >
                  {localize("暂不确定")}</Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
}
