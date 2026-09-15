import { compileAssessmentRouting } from '../../../../lib/assessment-routing-compiler';
const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
// Pure compiler, like the demo assistant: no rule writes or workflow execution here.
// Admin permission and rule persistence use the existing device-local identity model.
export async function POST(request: Request) {
  if (
    request.headers.get('origin') &&
    request.headers.get('origin') !== new URL(request.url).origin
  )
    return json({ error: '请在站点内创建规则。' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: '请求格式不正确。' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: '请输入匹配条件。' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 200000) {
        await reader.cancel();
        return json({ error: '匹配条件过长。' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = await compileAssessmentRouting(
      JSON.parse(new TextDecoder().decode(bytes)),
      { key: process.env.OPENAI_API_KEY, model: process.env.ASSISTANT_MODEL },
    );
    return json(result, result.status);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : '规则格式不正确。' },
      400,
    );
  }
}
