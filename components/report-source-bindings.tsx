'use client';
import { useI18n } from '@/lib/i18n/context';

import { NativeSelect } from '@/components/ui/native-select';
import {
  reportFields,
  stepFieldOptions,
  type ReportTemplate,
  type ReportBindings,
} from '@/lib/report-templates';
import type { ServiceFlowStep } from '@/lib/service-flow-steps';
export function ReportSourceBindings({
  template,
  steps,
  bindings,
  onChange,
  disabled = false,
}: {
  template: ReportTemplate;
  steps: ServiceFlowStep[];
  bindings: ReportBindings;
  onChange: (value: ReportBindings) => void;
  disabled?: boolean;
}) {
  const { localize, localizeMessage } = useI18n();
  const fields = reportFields(template.body).filter((f) => f.scope === 'step'),
    options = stepFieldOptions(steps);
  if (!fields.length) return null;
  return (
    <div className="report-source-bindings">
      <h4>{localize("步骤字段来源")}</h4>
      {localize(fields.map((f, i) => {
        const b = bindings[f.id],
          valid = options.some(
            (o) => o.stepId === b?.stepId && o.fieldId === b?.fieldId,
          );
        return (
          <label className="approval-field" key={f.id}>
            <span>
              {localize(f.label)}
              {localize(fields.filter((x) => x.label === f.label).length > 1
                ? localizeMessage(" · 引用 {0}", [String(localize(i + 1))])
                : '')}
            </span>
            <NativeSelect
              aria-label={localizeMessage("{0} 来源 {1}", [localize(f.label), localize(i + 1)])}
              disabled={disabled}
              value={valid ? JSON.stringify([b.stepId, b.fieldId]) : ''}
              onChange={(e) => {
                const next = { ...bindings };
                if (!e.target.value) delete next[f.id];
                else {
                  const [stepId, fieldId] = JSON.parse(e.target.value);
                  next[f.id] = { stepId, fieldId };
                }
                onChange(next);
              }}
            >
              <option value="">{localize("请选择来源步骤和字段")}</option>
              {localize(options.map((o) => (
                <option
                  key={JSON.stringify([o.stepId, o.fieldId])}
                  value={JSON.stringify([o.stepId, o.fieldId])}
                >
                  {localize(o.label)}
                </option>
              )))}
            </NativeSelect>
          </label>
        );
      }))}
    </div>
  );
}
