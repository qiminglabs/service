'use client';
import { useI18n } from '@/lib/i18n/context';


import { RequiredMark } from '@/components/required-mark';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FormFieldsLayout } from '@/components/request-form-layout';
import { ExecutionFieldControl } from '@/components/service-execution-field-control';
import {
  executionFormLayout,
  type ExecutionForm,
} from '@/lib/service-execution-forms';

export function ExecutionFormPreview({
  form,
  onClose,
}: {
  form: ExecutionForm;
  onClose: () => void;
}) {
  const { localize } = useI18n();
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="submission-rule-dialog service-flow-dialog">
        <DialogHeader>
          <DialogTitle>{localize(form.name || '未命名表单')} {localize(" · 预览")}</DialogTitle>
          <DialogDescription>{localize("试填内容不会保存。")}</DialogDescription>
        </DialogHeader>
        <div className="submission-rule-form">
          <div className="submission-rule-form-body">
            {localize(form.description && <p className="sr-help">{localize(form.description)}</p>)}
            <FormFieldsLayout
              fields={executionFormLayout(form)}
              renderField={(id) => {
                const field = form.fields.find((field) => field.id === id);
                if (!field) return null;
                return (
                  <div className="submission-rule-field">
                    <span>
                      {localize(field.name)}
                      {localize(field.required && <> <RequiredMark /></>)}
                    </span>
                    <ExecutionFieldControl
                      field={field}
                      value={values[id] ?? ''}
                      onChange={(value) =>
                        setValues((current) => ({ ...current, [id]: value }))
                      }
                    />
                  </div>
                );
              }}
            />
            {localize(!form.layout.order.length && (
              <p className="routing-empty">{localize("尚未添加字段。")}</p>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {localize("关闭预览")}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
