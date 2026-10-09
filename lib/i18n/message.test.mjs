import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectTranslations, checkProject } from '../../scripts/check-i18n.mjs';
import { translate, translateMessage, translateList } from './translate.ts';
import { translateMaterialRequirement } from './materials.ts';
import { fieldRequirementLabels } from '../request-field-requirements.ts';
import { fileURLToPath } from 'node:url';

test('message templates own word order and spacing and treat values as opaque', () => {
  const key = '{0}：{1}；可用选项：{2}';
  const values = ['License edition', 'Required', 'Basic, Standard'];
  assert.equal(translateMessage(key, values, 'en'), 'License edition: Required; Available options: Basic, Standard');
  assert.equal(translateMessage(key, values, 'en', { [key]: '{2}; {0}: {1}' }), 'Basic, Standard; License edition: Required');
  assert.equal(translateMessage('需求说明：{0}', ['客户的原文 $& {1}'], 'en'), 'Requirements: 客户的原文 $& {1}');
  assert.equal(translateMessage('需求说明：{0}', ['选填'], 'zh-CN'), '需求说明：选填');
});

test('material requirements cover all combinations without translating persisted values', () => {
  const material = { id: 'test', name: '售前向交付移交材料', required: true, instructions: '' };
  assert.equal(translateMaterialRequirement(material, 'en'), 'Technical assessment, Service delivery must be uploaded');
  assert.equal(translateMaterialRequirement(material, 'zh-CN'), '技术评估、服务交付必须上传');
  assert.equal(translateMaterialRequirement({ ...material, required: false }, 'en'), 'Optional');
  assert.equal(translateMaterialRequirement({ ...material, requiredByType: { 技术评估: false, 服务交付: true } }, 'en'), 'Service delivery must be uploaded');
  assert.equal(translateMaterialRequirement(material, 'en', { 技术评估: 'Assessment', '{0}必须上传': 'Upload required for {0}' }), 'Upload required for Assessment, Service delivery');
  for (const label of Object.values(fieldRequirementLabels)) assert.doesNotMatch(translate(label, 'en'), /[\u3400-\u9fff]/);
  assert.equal(translateList(['基础版', '敏捷版', '标准版', '企业版'], 'en'), 'Basic, Agile, Standard, Enterprise');
});

test('translation guard rejects concatenated inputs, missing templates and placeholder mismatches', () => {
  const keys = new Set(['名称：{0}']);
  for (const invalid of [
    'localize(values.join("、"))',
    'localize(ok ? values.join("、") : "无")',
    'localize(`名称：${name}`)',
    'localizeList(items.map(item => `${item.name}（必填）`))',
    'localize("名称：" + name)',
    'localizeMessage("不存在{0}", [name])',
    'localizeMessage("名称：{0}", [])',
    'localizeMessage(dynamicKey, [name])',
  ]) assert.ok(inspectTranslations(invalid, 'example.tsx', keys).length, invalid);
  for (const valid of [
    'localizeList(values)',
    'localizeMessage("名称：{0}", [name])',
    'localize(<Card key={ids.join(",")} />)',
    'localize(formatDate(new Date(`${date}T00:00:00Z`)))',
  ]) assert.deepEqual(inspectTranslations(valid, 'example.tsx', keys), [], valid);
  assert.deepEqual(checkProject(fileURLToPath(new URL('../../', import.meta.url))), []);
});
