import test from 'node:test';
import assert from 'node:assert/strict';
import { backendSettingsSections } from './backend-settings.ts';
import { emptyExecutionForms, parseExecutionForm, parseExecutionForms, bindExecutionForms, executionFormLayout } from './service-execution-forms.ts';
import { emptyServiceFlowConfig } from './service-flows.ts';
import { newServiceFlowStep } from './service-flow-steps.ts';

function form() {
  return {
    id: 'form',
    name: '实施记录',
    description: '',
    fields: [
      {
        id: 'description',
        name: '执行说明',
        type: 'textarea',
        options: [],
        required: true,
      },
      {
        id: 'date',
        name: '执行日期',
        type: 'date',
        options: [],
        required: false,
      },
      {
        id: 'result',
        name: '结果',
        type: 'single',
        options: ['通过', '不通过'],
        required: true,
      },
    ],
    layout: {
      order: ['date', 'result', 'description'],
      widths: { description: 'full', date: 'half', result: 'half' },
      rowStarts: ['result'],
    },
  };
}

test('服务步骤表单移入执行流程指定顺序，布局保留字段顺序宽度与换行', () => {
  const index = backendSettingsSections.findIndex(
    (row) => row.key === 'pricing',
  );
  assert.equal(backendSettingsSections[index - 1].key, 'execution-flow');
  assert.equal(backendSettingsSections.some(section => section.key === 'execution-forms'), false);
  assert.deepEqual(backendSettingsSections[index - 1].tabs.map(tab => tab.label), ['协作人分配', '请求转项目映射', '服务商管理', '服务流程', '服务步骤表单', '特殊审批流程', '邮件模板']);
  const checked = parseExecutionForm(form());
  assert.deepEqual(executionFormLayout(checked), [
    { id: 'date', gridColumn: 'span 1' },
    { id: 'result', gridColumn: '1 / span 1' },
    { id: 'description', gridColumn: '1 / -1' },
  ]);
  checked.layout.order = ['description'];
  checked.layout.rowStarts = [];
  assert.equal(parseExecutionForm(checked).fields.length, 3);
  assert.equal(executionFormLayout(checked).length, 1);
});

test('拒绝重复字段、无效选项和损坏布局，布局必须至少包含一个字段', () => {
  const sample = form();
  sample.fields[2].options = ['通过', ' 通过 '];
  assert.throws(() => parseExecutionForm(sample), /选项/);
  const duplicate = form();
  duplicate.fields.push(duplicate.fields[0]);
  assert.throws(() => parseExecutionForm(duplicate), /字段/);
  const missing = form();
  missing.layout.order.push('missing');
  assert.throws(() => parseExecutionForm(missing), /布局/);
  const width = form();
  width.layout.widths.date = 'third';
  assert.throws(() => parseExecutionForm(width), /布局/);
  const empty = form();
  empty.layout.order = [];
  assert.throws(() => parseExecutionForm(empty), /布局/);
  assert.throws(
    () =>
      parseExecutionForms({
        ...emptyExecutionForms(),
        forms: [form(), form()],
      }),
    /重复/,
  );
});
