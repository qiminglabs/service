import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate, translateList, translateMessage } from './translate.ts';
import { translateMaterialRequirement } from './materials.ts';
import { fieldRequirementLabels } from '../request-field-requirements.ts';

function renderSnapshot(locale, labels = {}) {
  const file = new URL('../../components/catalog-history.tsx', import.meta.url);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const runtime = runInNewContext(`${compiled}; ({ ConfigSnapshot });`, { exports: {}, require: name => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return jsx;
    if (name === '@/lib/i18n/context') return { useI18n: () => ({
      locale, labels,
      localize: value => translate(value, locale, labels),
      localizeList: values => translateList(values, locale, labels),
      localizeMessage: (key, values) => translateMessage(key, values, locale, labels),
    }) };
    if (name === '@/lib/i18n/materials') return { translateMaterialRequirement };
    if (name === '@/lib/request-field-requirements') return { fieldRequirementLabels };
    if (name === '@/components/ui/button') return { Button: props => React.createElement('button', props) };
    return {};
  } });
  const config = {
    basicFields: { description: { required: false }, businessObjects: { enabled: false } },
    fields: ['edition', 'nodes', 'address'],
    fieldNames: { edition: '授权版本', nodes: '节点数', address: '地址' },
    fieldOptions: { edition: ['基础版', '敏捷版', '标准版', '企业版'], nodes: [], address: [] },
    fieldRequiredWhen: { address: 'onsite' },
    materials: [{ id: 'handover', name: '售前向交付移交材料', required: true,
      instructions: '按模板说明硬件、网络、部署范围和准备情况；不适用章节请说明原因。', templateUrl: '/templates/handover-template.docx' }],
  };
  const before = structuredClone(config);
  const html = renderToStaticMarkup(React.createElement(runtime.ConfigSnapshot, { config, title: '内部申请表单' }));
  assert.deepEqual(config, before);
  return html;
}

test('catalog history renders complete English sentences, lists, conditions and material requirements', () => {
  const html = renderSnapshot('en');
  assert.doesNotMatch(html, /[\u3400-\u9fff]/);
  for (const text of ['Requirements: Optional', 'Business objects: Hidden; Searchable products: Any', 'License edition: Required; Available options: Basic, Agile, Standard, Enterprise', 'Address: Shown and required for onsite service', 'Technical assessment, Service delivery must be uploaded']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('Node count: Required</p>'));
  assert.ok(renderSnapshot('en', { 授权版本: 'Edition label' }).includes('Edition label: Required'));
  const chinese = renderSnapshot('zh-CN');
  assert.ok(chinese.includes('基础版、敏捷版、标准版、企业版'));
  assert.ok(chinese.includes('技术评估、服务交付必须上传'));
});
