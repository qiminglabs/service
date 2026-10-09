import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate, translateExact, translateList, translateMessage } from './translate.ts';
import { formatDays } from '../day-quantity.ts';
function render(approval, locale, labels = {}) {
  const source = fs.readFileSync(new URL('../../components/assessment-approval-card.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  const runtime = runInNewContext(`${compiled}; exports;`, { exports, require: name => {
    if (name === 'react/jsx-runtime') return jsx;
    if (name === '@/lib/i18n/translate') return { translateExact };
    if (name === '@/lib/day-quantity') return { formatDays };
    if (name === '@/lib/i18n/context') return { useI18n: () => ({ locale, labels,
      localize: value => translate(value, locale, labels),
      localizeList: values => translateList(values, locale, labels),
      localizeMessage: (key, values) => translateMessage(key, values, locale, labels),
    }) };
    throw Error(name);
  } });
  return renderToStaticMarkup(createElement(runtime.AssessmentApprovalCard, { approval }));
}
test('approval card renders complete English headings, saved demo text and mixed-method quantities', () => {
  const approval = { days: 4.4, gaps: [{ method: '远程', days: 4.4 }], author: '王琪', approver: '陆明', at: '2026-10-01T10:00:00Z', state: '已通过', reason: '演示用特殊审批，按已保存规则依次处理。', workflow: { ruleName: '金融客户特殊审批', steps: [{ id: 'step-manager', nodeName: '申请人汇报人审批', approver: '陆明', state: '已通过', fallback: true, fallbackReason: '陆明未设置汇报人，无法确定第 1 级审批人。', note: '已核对本环节服务需求，同意本次演示申请。' }, { id: 'step-final', nodeName: '最终审批', approver: '陆明', state: '已通过' }] } };
  const before = structuredClone(approval);
  const html = render(approval, 'en');
  assert.match(html, /Allowance exception: Remote 4.4 person-days/);
  assert.match(html, /Financial customer exception approval/);
  assert.match(html, /Final approval/);
  assert.match(html, /Default approver fallback: /);
  assert.doesNotMatch(html.replaceAll('陆明', '').replaceAll('王琪', ''), /[\u3400-\u9fff]/);
  assert.equal(translateExact('constructor', 'en'), 'constructor');
  assert.doesNotMatch(html, /person-daysAllowance/);
  assert.match(render(approval, 'zh-CN'), /远程 4.4 人天额度特批/);
  assert.match(render({ ...approval, gaps: [{ method: '远程', days: 2 }, { method: '现场', days: 2.4 }] }, 'en'), /Remote 2 person-days, Onsite 2.4 person-days/);
  assert.match(render({ ...approval, reason: '用户手写意见：远程、现场' }, 'en'), /用户手写意见：远程、现场/);
  assert.match(render(approval, 'en', { '{0}额度特批': 'Exception for {0}' }), /Exception for Remote 4.4 person-days/);
  assert.deepEqual(approval, before);
});
