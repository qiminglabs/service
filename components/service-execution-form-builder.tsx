'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { GripVertical, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { FormFieldsLayout } from '@/components/request-form-layout';
import { ExecutionFieldControl } from '@/components/service-execution-field-control';
import { startRequestFieldDrag } from '@/lib/request-field-drag';
import { moveRequestFormField } from '@/lib/request-form-layout';
import {
  executionFieldTypes,
  executionFormLayout,
  type ExecutionField,
  type ExecutionForm,
} from '@/lib/service-execution-forms';

export function ExecutionFormBuilder({
  form,
  disabled,
  onChange,
}: {
  form: ExecutionForm;
  disabled: boolean;
  onChange: (form: ExecutionForm) => void;
}) {
  const [selected, select] = useState(form.fields[0]?.id ?? '');
  const root = useRef<HTMLDivElement>(null),
    cancelDrag = useRef<(() => void) | null>(null),
    suppress = useRef(false);
  const field = form.fields.find((field) => field.id === selected);
  const order = form.layout.order;
  useEffect(() => () => cancelDrag.current?.(), []);
  useEffect(() => {
    if (disabled) cancelDrag.current?.();
  }, [disabled]);
  function update(next: ExecutionForm) {
    if (!disabled) onChange(next);
  }
  function patch(change: Partial<ExecutionField>) {
    update({
      ...form,
      fields: form.fields.map((row) =>
        row.id === selected ? { ...row, ...change } : row,
      ),
    });
  }
  function add(id: string, target?: string) {
    update({
      ...form,
      layout: {
        ...form.layout,
        order: moveRequestFormField(order, id, target),
      },
    });
    select(id);
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (disabled || event.button !== 0 || !event.isPrimary || !root.current)
      return;
    cancelDrag.current?.();
    suppress.current = false;
    cancelDrag.current = startRequestFieldDrag({
      source: event.currentTarget,
      root: root.current,
      id,
      order,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      onDrag: () => {
        suppress.current = true;
      },
      onEnd: () => {
        setTimeout(() => {
          suppress.current = false;
        }, 0);
      },
      onDrop: add,
    });
  }
  function createField() {
    const id = crypto.randomUUID();
    const field: ExecutionField = {
      id,
      name: `字段 ${form.fields.length + 1}`,
      type: 'text',
      required: false,
      options: [],
    };
    update({
      ...form,
      fields: [...form.fields, field],
      layout: {
        ...form.layout,
        order: [...order, id],
        widths: { ...form.layout.widths, [id]: 'half' },
      },
    });
    select(id);
  }
  const index = order.indexOf(selected);
  return (
    <div
      className="rf-builder execution-form-builder"
      ref={root}
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (suppress.current && event.detail !== 0) {
          suppress.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <main className="rf-center">
        <div className="rf-preview-heading">
          <strong>服务步骤表单预览</strong>
          <div className="execution-form-preview-actions">
            <span>拖动字段可调整顺序</span>
            <Button
              disabled={disabled || form.fields.length >= 100}
              onClick={createField}
            >
              <Plus size={14} />
              添加字段
            </Button>
          </div>
        </div>
        <div className="rf-paper">
          <h3>{form.name || '未命名表单'}</h3>
          {form.description && <p className="sr-help">{form.description}</p>}
          <div className="rf-canvas">
            <FormFieldsLayout
              fields={executionFormLayout(form)}
              renderField={(id) => {
                const row = form.fields.find((field) => field.id === id);
                if (!row) return null;
                return (
                  <div
                    className="rf-preview-field"
                    data-field-id={id}
                    data-selected={selected === id}
                  >
                    <button
                      type="button"
                      className="rf-select-field"
                      disabled={disabled}
                      aria-label={`配置${row.name}`}
                      onPointerDown={(event) => beginDrag(event, id)}
                      onClick={() => select(id)}
                    >
                      <span>
                        {row.name} {row.required && <em>*</em>}
                      </span>
                      <GripVertical size={15} />
                    </button>
                    <div
                      className="rf-control-preview"
                      onPointerDown={() => select(id)}
                    >
                      <fieldset disabled aria-hidden="true">
                        <ExecutionFieldControl
                          field={row}
                          value=""
                          disabled
                          onChange={() => {}}
                        />
                      </fieldset>
                    </div>
                  </div>
                );
              }}
            />
          </div>
        </div>
      </main>
      <aside className="rf-properties">
        <h3>字段属性</h3>
        {field ? (
          <>
            <label className="rf-property-input">
              <span>字段名称 *</span>
              <Input
                disabled={disabled}
                required
                maxLength={120}
                value={field.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="rf-property-input">
              <span>字段类型</span>
              <NativeSelect
                disabled={disabled}
                value={field.type}
                onChange={(event) =>
                  patch({
                    type: event.target.value as ExecutionField['type'],
                    ...(['single', 'multiple'].includes(event.target.value) &&
                    !field.options.length
                      ? { options: ['选项 1'] }
                      : {}),
                  })
                }
              >
                {Object.entries(executionFieldTypes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {['single', 'multiple'].includes(field.type) && (
              <label className="rf-property-input">
                <span>选项（每行一项）</span>
                <Textarea
                  rows={5}
                  disabled={disabled}
                  value={field.options.join('\n')}
                  onChange={(event) =>
                    patch({ options: event.target.value.split('\n') })
                  }
                />
              </label>
            )}
            <label className="sr-check-line">
              <input
                type="checkbox"
                disabled={disabled}
                checked={field.required}
                onChange={(event) => patch({ required: event.target.checked })}
              />
              必填
            </label>
            <fieldset disabled={disabled}>
              <legend>字段宽度</legend>
              <div className="rf-width-options">
                {(['half', 'full'] as const).map((width) => (
                  <label key={width}>
                    <input
                      type="radio"
                      name="execution-field-width"
                      checked={
                        (form.layout.widths[selected] ?? 'half') === width
                      }
                      onChange={() =>
                        update({
                          ...form,
                          layout: {
                            ...form.layout,
                            widths: {
                              ...form.layout.widths,
                              [selected]: width,
                            },
                          },
                        })
                      }
                    />
                    {width === 'full' ? '整行' : '半行'}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="sr-check-line">
              <input
                type="checkbox"
                disabled={disabled || form.layout.widths[selected] === 'full'}
                checked={form.layout.rowStarts.includes(selected)}
                onChange={(event) =>
                  update({
                    ...form,
                    layout: {
                      ...form.layout,
                      rowStarts: event.target.checked
                        ? [...form.layout.rowStarts, selected]
                        : form.layout.rowStarts.filter((id) => id !== selected),
                    },
                  })
                }
              />
              另起一行
            </label>
            <div className="rf-move service-phase-actions">
              <Button
                variant="outline"
                disabled={disabled || index <= 0}
                onClick={() => add(selected, order[index - 1])}
              >
                <ArrowUp size={14} />
                上移
              </Button>
              <Button
                variant="outline"
                disabled={disabled || index < 0 || index === order.length - 1}
                onClick={() => add(selected, order[index + 1])}
              >
                <ArrowDown size={14} />
                下移
              </Button>
            </div>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                const widths = { ...form.layout.widths };
                delete widths[selected];
                update({
                  ...form,
                  fields: form.fields.filter((row) => row.id !== selected),
                  layout: {
                    order: order.filter((id) => id !== selected),
                    widths,
                    rowStarts: form.layout.rowStarts.filter(
                      (id) => id !== selected,
                    ),
                  },
                });
                select('');
              }}
            >
              <Trash2 size={14} />
              删除字段
            </Button>
          </>
        ) : (
          <p className="sr-help">添加字段或选择字段后配置属性。</p>
        )}
      </aside>
    </div>
  );
}
