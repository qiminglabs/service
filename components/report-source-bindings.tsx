'use client';
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
  const fields = reportFields(template.body).filter((f) => f.scope === 'step'),
    options = stepFieldOptions(steps);
  if (!fields.length) return null;
  return (
    <div className="report-source-bindings">
      <h4>步骤字段来源</h4>
      {fields.map((f, i) => {
        const b = bindings[f.id],
          valid = options.some(
            (o) => o.stepId === b?.stepId && o.fieldId === b?.fieldId,
          );
        return (
          <label className="approval-field" key={f.id}>
            <span>
              {f.label}
              {fields.filter((x) => x.label === f.label).length > 1
                ? ` · 引用 ${i + 1}`
                : ''}
            </span>
            <NativeSelect
              aria-label={`${f.label} 来源 ${i + 1}`}
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
              <option value="">请选择来源步骤和字段</option>
              {options.map((o) => (
                <option
                  key={JSON.stringify([o.stepId, o.fieldId])}
                  value={JSON.stringify([o.stepId, o.fieldId])}
                >
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </label>
        );
      })}
    </div>
  );
}
