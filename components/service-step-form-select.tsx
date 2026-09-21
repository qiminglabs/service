'use client';

import { RequiredMark } from '@/components/required-mark';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { ExecutionFormPreview } from '@/components/service-execution-form-preview';
import { readExecutionFormData } from '@/lib/service-execution-form-store';
import {
executionFormStepFields,
type ExecutionForm
} from '@/lib/service-execution-forms';
import type { ServiceFlowStep } from '@/lib/service-flow-steps';

export function ServiceStepFormSelect({
  step,
  editable,
  onChange,
}: {
  step: ServiceFlowStep;
  editable: boolean;
  onChange: (patch: Partial<ServiceFlowStep>) => void;
}) {
  const [forms, setForms] = useState<ExecutionForm[]>();
  const [error, setError] = useState(''),
    [preview, setPreview] = useState(false);
  useEffect(() => {
    let active = true;
    void readExecutionFormData()
      .then((data) => {
        if (active) setForms(data.library.forms);
      })
      .catch((issue) => {
        if (active)
          setError(issue instanceof Error ? issue.message : '表单读取失败。');
      });
    return () => {
      active = false;
    };
  }, []);
  const id = step.executionFormId;
  const selected =
    !editable && step.executionForm
      ? step.executionForm
      : forms?.find((form) => form.id === id);
  return (
    <div className="service-step-deliverables">
      <label className="approval-field">
        <span>服务步骤表单 <RequiredMark /></span>
        <NativeSelect
          aria-label="选择服务步骤表单"
          disabled={!editable || !forms}
          value={forms?.some((form) => form.id === id) ? id : ''}
          onChange={(event) => {
            const form = forms?.find((row) => row.id === event.target.value);
            if (!form) return;
            onChange({
              executionFormId: form.id,
              executionForm: structuredClone(form),
              formFields: executionFormStepFields(form),
            });
          }}
        >
          <option value="" disabled>
            {forms ? '请选择服务步骤表单' : '正在读取表单…'}
          </option>
          {forms?.map((form) => (
            <option key={form.id} value={form.id}>
              {form.name}
            </option>
          ))}
        </NativeSelect>
      </label>
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <>
          <p className="sr-help">
            {selected.name} · {selected.layout.order.length} 个字段
          </p>
          <Button variant="outline" onClick={() => setPreview(true)}>
            预览表单
          </Button>
        </>
      ) : (
        <p className="sr-help">
          请先在“服务执行流程 → 服务步骤表单”选项卡创建字段和布局，再选择表单。
        </p>
      )}
      {selected && preview && (
        <ExecutionFormPreview
          form={selected}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
