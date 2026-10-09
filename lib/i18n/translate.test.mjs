import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { translate } from './translate.ts';
import { validateTranslation, parseTranslations } from './store.ts';
import patterns from './patterns.json' with { type: 'json' };
import messages from './en.json' with { type: 'json' };

test('Chinese remains the canonical language; translating display values does not mutate data', () => {
  const record = Object.freeze({ role: 'SmartX 项目经理', status: '待确认', name: '客户原始名称' });
  assert.equal(translate(record, 'en'), record);
  assert.equal(translate(record.status, 'en'), 'Pending confirmation');
  assert.equal(record.status, '待确认');
  assert.equal(translate(record.status, 'zh-CN', { 待确认: 'Custom' }), '待确认');
  assert.equal(translate('客户原始名称', 'en'), '客户原始名称');
  const callback = () => '保存';
  assert.equal(translate(callback, 'en'), callback);
});
test('custom labels, interpolated alerts and variable order are respected', () => {
  assert.equal(translate('保存', 'en', { 保存: 'Save changes now' }), 'Save changes now');
  assert.equal(translate('返回服务项目', 'en'), 'Back to Service Projects');
  assert.equal(translate('最少 2.5 人天', 'en'), 'Minimum 2.5 person-days');
  assert.equal(translate('最少 2.5 人天', 'en', { '最少 {0} 人天': 'At least {0} days' }), 'At least 2.5 days');
  assert.equal(translate('当前用户：张三，切换身份', 'en'), 'Current user: 张三; switch user');
  assert.equal(translate('张三 · SmartX 项目经理', 'en'), '张三 · SmartX Project Manager');
});
test('all bundled templates preserve placeholders and actually match interpolated messages', () => {
  for (const [source, english] of patterns) {
    assert.equal(validateTranslation(source, english), null, source);
    const concrete = source.replace(/\{(\d+)\}/g, (_, id) => `X${id}`);
    const translated = translate(concrete, 'en');
    if (/[\u3400-\u9fff]/.test(concrete)) assert.notEqual(translated, concrete, source);
  }
  for (const [source, english] of Object.entries(messages)) assert.equal(translate(source, 'en'), english, source);
});
test('translation edits reject lost placeholders and empty values', () => {
  assert.ok(validateTranslation('最少 {0} 人天', 'Minimum days'));
  assert.ok(validateTranslation('保存', '  '));
  assert.equal(validateTranslation('{0} 到 {1}', '{1} after {0}'), null);
  assert.deepEqual(Object.keys(parseTranslations({ revision: 2, labels: { 保存: 'Save', 无效: 5, 空: '' } }).labels), ['保存']);
});
test('translated native select options retain explicit original values', () => {
  function check(file) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'option' && node.children.some(child => child.getText(source).includes('localize('))) {
        assert.ok(node.openingElement.attributes.properties.some(attr => attr.name?.getText(source) === 'value'), `${file}: translated option needs a canonical value`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const entry of fs.readdirSync(new URL('../../components/', import.meta.url))) if (entry.endsWith('.tsx')) check(new URL(`../../components/${entry}`, import.meta.url).pathname);
  check(new URL('../../app/page.tsx', import.meta.url).pathname);
});
