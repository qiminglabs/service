import type { StoredFile } from './service-requests';
import {
  parseReportTemplate,
  reportFields,
  reportText,
  type ReportNode,
} from './report-templates.ts';

export type ProjectMailDocument = NonNullable<StoredFile['onlineDocument']>;

export function projectMailDocumentIssue(
  doc?: ProjectMailDocument,
): string | null {
  if (
    !doc?.reportSource ||
    doc.reportSource.template.scope !== 'project' ||
    !doc.richText
  )
    return '请选择项目报告模板并生成正文。';
  try {
    const template = parseReportTemplate(doc.reportSource.template);
    if (reportFields(template.body).some((field) => field.scope !== 'project'))
      return '项目报告模板只能引用项目字段。';
    parseReportTemplate({ ...template, body: doc.richText as ReportNode });
    if (reportFields(doc.richText as ReportNode).length)
      return '报告中仍有未填充的字段。';
    if (!reportText(doc.richText as ReportNode).trim())
      return '请填写项目报告正文。';
    if (!doc.title.trim() || doc.title.length > 300)
      return '报告标题不能为空且不超过 300 字。';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '项目报告正文无效。';
  }
}

export const escapeReportHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );

// Render only the supported document nodes and marks; never pass through HTML or attributes.
export function projectMailBodyHtml(node: ReportNode): string {
  if (node.type === 'text') {
    let text = escapeReportHtml(node.text ?? '');
    const tags: Record<string, string> = {
      bold: 'strong',
      italic: 'em',
      underline: 'u',
      strike: 's',
      code: 'code',
    };
    for (const mark of node.marks ?? [])
      if (tags[mark.type])
        text = `<${tags[mark.type]}>${text}</${tags[mark.type]}>`;
    return text;
  }
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'horizontalRule') return '<hr>';
  const content = (node.content ?? []).map(projectMailBodyHtml).join('');
  const tags: Record<string, string> = {
    paragraph: 'p',
    bulletList: 'ul',
    orderedList: 'ol',
    listItem: 'li',
    blockquote: 'blockquote',
    codeBlock: 'pre',
  };
  const tag =
    node.type === 'heading'
      ? `h${[1, 2, 3].includes(Number(node.attrs?.level)) ? Number(node.attrs?.level) : 3}`
      : tags[node.type];
  return tag ? `<${tag}>${content}</${tag}>` : content;
}
