import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate, translateList, translateMessage } from './translate.ts';
const source = fs.readFileSync(new URL('./context.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
const runtime = runInNewContext(`${compiled}; ({ ...exports, context: LanguageContext });`, { exports, require: name => {
  if (name === 'react') return React;
  if (name === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement };
  if (name === './translate') return { translate, translateList, translateMessage };
  if (name === './store') return { readTranslations: async () => ({ labels: {} }), translationsEvent: 'translations' };
  throw Error(name);
} });
function Consumer() { const { localize } = runtime.useI18n(); return React.createElement('span', null, localize('保存')); }
test('Chinese is the default language including the initial server render', () => {
  const html = renderToStaticMarkup(React.createElement(runtime.LanguageProvider, null, React.createElement(Consumer)));
  assert.equal(html, '<span>保存</span>');
});
test('configuration scopes retain Chinese while front-end labels use saved English overrides', () => {
  const value = { locale: 'en', labels: { 保存: 'Save record' }, setLocale() {} };
  const tree = React.createElement(runtime.context.Provider, { value },
    React.createElement(Consumer),
    React.createElement(runtime.LanguageScope, { chinese: true }, React.createElement(Consumer)),
    React.createElement(runtime.LanguageScope, { chinese: false }, React.createElement(Consumer)));
  assert.equal(renderToStaticMarkup(tree), '<span>Save record</span><span>保存</span><span>Save record</span>');
});

test('message and list helpers honor Chinese configuration scopes and editable English labels', () => {
  function Sentence() {
    const { localizeMessage, localizeList } = runtime.useI18n();
    return React.createElement('span', null, localizeMessage('需求说明：{0}', [localizeList(['远程', '现场'])]));
  }
  const value = { locale: 'en', labels: { 远程: 'Remote delivery', '需求说明：{0}': 'Options: {0}' }, setLocale() {} };
  const tree = React.createElement(runtime.context.Provider, { value },
    React.createElement(Sentence),
    React.createElement(runtime.LanguageScope, { chinese: true }, React.createElement(Sentence)));
  assert.equal(renderToStaticMarkup(tree), '<span>Options: Remote delivery, Onsite</span><span>需求说明：远程、现场</span>');
});
