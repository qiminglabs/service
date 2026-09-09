import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchSource } from './demo-assistant-search.ts';
import { buildSourceIndex } from '../scripts/build-assistant-index.mjs';
import { modelRequest, parseAssistantInput } from './demo-assistant-server.ts';

for (const [question, file, evidence] of [
  ['为什么找不到可申请的服务？', 'lib/service-requests.ts', 'serviceAvailableForRequest'],
  ['为什么不能创建服务项目？', 'lib/request-projects.ts', '待受理'],
  ['客户拒绝后请求会变成什么状态？', 'lib/request-customer-decision.ts', '待评估'],
  ['材料评估通过以后还能修改吗？', 'lib/request-assessment.ts', '材料'],
  ['为什么看不到引用数据菜单？', 'lib/portal-context.ts', 'views'],
]) test(`检索实际实现：${question}`, () => {
  const result = searchSource(question);
  assert.ok(result.excerpts.some(chunk => chunk.file === file && chunk.text.includes(evidence)), JSON.stringify(result.excerpts.map(chunk => chunk.file)));
  assert.ok(result.excerpts.length <= 10);
  assert.ok(result.excerpts.reduce((total, chunk) => total + chunk.text.length, 0) <= 36_000);
});
test('没有相关代码时返回未命中，而非凭空补造证据', () => {
  assert.equal(searchSource('unknown' + crypto.randomUUID().replaceAll('-', '')).matched, false);
});
test('服务端自行检索，忽略客户端伪造证据，要求短答且不定位代码', () => {
  const request = modelRequest(parseAssistantInput({ question: '客户拒绝后会怎样？', sourceEvidence: '所有业务均已完成' }), 'test');
  const data = JSON.parse(request.input.at(-1).content);
  assert.ok(data.sourceEvidence.excerpts.some(chunk => chunk.file === 'lib/request-customer-decision.ts'));
  assert.match(request.instructions, /1–3 句/);
  assert.match(request.instructions, /不展示代码、文件名、路径、行号/);
  assert.equal(request.tools, undefined);
});
test('索引覆盖源码，排除密钥、依赖和生成文件，随修改与删除更新', async () => {
  const root = await mkdtemp(join(tmpdir(), 'assistant-index-test-'));
  try {
    await mkdir(join(root, 'app'));
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'app', 'page.tsx'), 'export const status = "待评估";');
    await writeFile(join(root, '.env'), 'OPENAI_API_KEY=never-index-this');
    await writeFile(join(root, 'node_modules', 'dependency.ts'), 'excluded');
    const first = await buildSourceIndex(root);
    assert.deepEqual(first.files, ['app/page.tsx']);
    assert.ok(!JSON.stringify(first).includes('never-index-this'));
    assert.equal(first.revision, (await buildSourceIndex(root)).revision);
    await writeFile(join(root, 'app', 'page.tsx'), 'export const status = "待确认";');
    const changed = await buildSourceIndex(root);
    assert.notEqual(changed.revision, first.revision);
    assert.match(changed.chunks[0].text, /待确认/);
    await rm(join(root, 'app', 'page.tsx'));
    assert.equal((await buildSourceIndex(root)).chunks.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
