'use client';
import { useI18n } from '@/lib/i18n/context';

import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  defaultReportBindings,
  type ReportTemplate,
  type ReportTemplateSelection,
} from '@/lib/report-templates';
import type { ServiceFlowStep } from '@/lib/service-flow-steps';

export function StepReportTemplateSelect({
  value,
  steps,
  templates,
  editable,
  onChange,
  onManage,
}: {
  value?: ReportTemplateSelection;
  steps: ServiceFlowStep[];
  templates: ReportTemplate[];
  editable: boolean;
  onChange: (value: ReportTemplateSelection | undefined) => void;
  onManage: () => void;
}) {
  const { localize } = useI18n();
  const current = value?.template;
  return (
    <section className="report-step-template">
      <label className="approval-field">
        <span>{localize("工单文档模板")}</span>
        <NativeSelect
          aria-label={localize("选择工单文档模板")}
          disabled={!editable}
          value={current?.id ?? ''}
          onChange={(event) => {
            const template = templates.find(
              (t) => t.id === event.target.value && t.enabled,
            );
            onChange(
              template
                ? {
                    template: structuredClone(template),
                    bindings: defaultReportBindings(template, steps),
                  }
                : undefined,
            );
          }}
        >
          <option value="">{localize("不使用工单文档模板")}</option>
          {localize(current &&
            !templates.some((t) => t.enabled && t.id === current.id) && (
              <option value={current.id}>{localize(current.name)} {localize(" · 已绑定")}</option>
            ))}
          {localize(templates
            .filter((t) => t.enabled)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {localize(t.name)}
              </option>
            )))}
        </NativeSelect>
      </label>
      <div className="report-template-version">
        <span>{localize(current ? `已绑定 v${current.version}` : '当前流程模板')}</span>
        <Button size="sm" variant="ghost" onClick={onManage}>
          {localize("前往文档模板")}</Button>
      </div>
    </section>
  );
}
