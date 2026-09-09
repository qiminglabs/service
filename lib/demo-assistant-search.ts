// Imported only by the assistant server. The browser never downloads this index.
import index from '../.generated/assistant-source-index.json' with { type: 'json' };

type Chunk = { file: string; start: number; kind: string; text: string };
const chunks: Chunk[] = index.chunks;
const stopWords = new Set(['为什么', '怎么', '如何', '哪里', '什么', '这个', '那个', '可以', '不能', '没有', '需要', '是否', '一下', '功能', '问题', '操作', '助手', '代码', '站点', '当前', '用户']);
export function searchTerms(text: string) {
  const words: string[] = [];
  for (const segment of text.toLowerCase().match(/[a-z][a-z0-9_]+|[\p{Script=Han}]+/gu) || []) {
    if (/^[a-z]/.test(segment)) words.push(segment);
    else {
      for (let length = 2; length <= Math.min(4, segment.length); length++) {
        for (let offset = 0; offset <= segment.length - length; offset++) {
          const term = segment.slice(offset, offset + length);
          if (!stopWords.has(term)) words.push(term);
        }
      }
    }
  }
  return [...new Set(words)];
}
const postings = new Map<string, number[]>();
chunks.forEach((chunk, id) => { for (const term of searchTerms(`${chunk.file} ${chunk.text}`)) { const list = postings.get(term) || []; list.push(id); postings.set(term, list); } });
const synonyms = [
  { match: /提交|必填|校验|材料|草稿/, terms: '提交申请 申请项 补充材料 保存草稿 requestSubmitIssues' },
  { match: /审批|评估|人天|依据|额度/, terms: '材料评估 核定人天 关联服务依据 客户确认 assessmentLockIssue' },
  { match: /服务项目|工单|受理|拆分|分配/, terms: '创建服务项目 待受理 申请项 projectCreationSaveIssue canCreateServiceProjects' },
  { match: /确认|拒绝|退回/, terms: '客户确认 拒绝 待确认 待受理 customerDecisionIssue' },
  { match: /菜单|角色|权限|身份|入口/, terms: 'resolvePortalContext currentActor currentRole views' },
  { match: /目录|可申请|服务.*不.*到|发起站点/, terms: 'serviceAvailableForRequest allowedInitiatorSites 已启用 内部系统 客户中心' },
  { match: /会议|转写|录制/, terms: '会议 预约 转写 录制 本地模拟' },
];
export function searchSource(question: string, context: { page?: string; tab?: string; status?: string } = {}, previousQuestion = '') {
  const primary = searchTerms(question);
  const expanded = searchTerms(synonyms.filter(item => item.match.test(question)).map(item => item.terms).join(' '));
  const followup = question.length < 24 ? searchTerms(previousQuestion.slice(-500)) : [];
  const secondary = searchTerms(`${context.tab || ''} ${context.status || ''}`);
  const scores = new Map<number, number>();
  function add(terms: string[], weight: number) {
    for (const term of terms) {
      const ids = postings.get(term);
      if (!ids) continue;
      const idf = Math.log(1 + chunks.length / ids.length);
      for (const id of ids) scores.set(id, (scores.get(id) || 0) + weight * idf);
    }
  }
  add(primary, 1); add(expanded.filter(term => !/^[a-z]/.test(term)), 0.35); add(expanded.filter(term => /^[a-z]/.test(term)), 4); add(followup, 0.2); add(secondary, 0.15);
  const sorted = [...scores].map(([id, score]) => {
    const chunk = chunks[id];
    const isAssistant = /demo-assistant|assistant-source|build-assistant/.test(chunk.file);
    const assistantQuestion = /助手|源码|代码检索|模型|openai|api/i.test(question);
    return { id, score: score * (chunk.kind === 'test' ? 0.45 : 1) * (isAssistant && !assistantQuestion ? 0.08 : 1) };
  }).sort((a, b) => b.score - a.score);
  const selected: Chunk[] = [];
  const perFile = new Map<string, number>();
  for (const result of sorted) {
    const chunk = chunks[result.id];
    if ((perFile.get(chunk.file) || 0) >= 3) continue;
    selected.push(chunk); perFile.set(chunk.file, (perFile.get(chunk.file) || 0) + 1);
    if (selected.length === 10) break;
  }
  return { revision: index.revision, indexedFiles: index.files.length, matched: selected.length > 0, excerpts: selected, scope: '当前站点项目源码；仅检索匹配片段，不等于模型已通读全部代码。测试仅作辅助证据，不代表功能已上线。' };
}
