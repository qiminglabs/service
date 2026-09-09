import { answerQuestion, parseAssistantInput } from '../../../lib/demo-assistant-server';

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
// Anonymous and read-only: no identity middleware, database or business actions.
export async function POST(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return json({ error: '请在站点内使用功能助手。' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: '请求格式不正确。' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '请输入问题。' }, 400);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) { await reader.cancel(); return json({ error: '问题或对话过长，请清空对话后重试。' }, 413); }
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const input = parseAssistantInput(JSON.parse(new TextDecoder().decode(buffer)));
    const result = await answerQuestion(input, { key: process.env.OPENAI_API_KEY, model: process.env.ASSISTANT_MODEL });
    return json(result.answer ? { answer: result.answer } : { error: result.error }, result.status);
  } catch { return json({ error: '问题或对话格式不正确。' }, 400); }
}
