import { compileSubmissionRule } from '../../../../lib/submission-rule-compiler';
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
// Pure compiler, like the demo assistant: no rule writes or workflow execution here.
// Admin permission and rule persistence use the existing device-local identity model.
export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: '请在站点内创建规则。' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '请求格式不正确。' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '请输入检验要求。' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 16000) { await reader.cancel(); return json({ error: '检验要求过长。' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const result = await compileSubmissionRule(JSON.parse(new TextDecoder().decode(bytes)), { key: process.env.OPENAI_API_KEY, model: process.env.ASSISTANT_MODEL });
    return json(result, result.status);
  } catch (error) { return json({ error: error instanceof Error ? error.message : '规则格式不正确。' }, 400); }
}
