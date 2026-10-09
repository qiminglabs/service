
import { useI18n } from '@/lib/i18n/context';
import { Fragment, type ReactNode } from 'react';
import { reportFieldLabel, type ReportNode } from '@/lib/report-templates';
export function ReportBody({ body }: { body: ReportNode }) {
  const { localize } = useI18n();
  function render(node: ReportNode, key: number): ReactNode {
    if (node.type === 'text') {
      let content: ReactNode = node.text;
      for (const m of node.marks ?? []) {
        if (m.type === 'bold') content = <strong>{localize(content)}</strong>;
        if (m.type === 'italic') content = <em>{localize(content)}</em>;
        if (m.type === 'underline') content = <u>{localize(content)}</u>;
        if (m.type === 'strike') content = <s>{localize(content)}</s>;
        if (m.type === 'code') content = <code>{localize(content)}</code>;
      }
      return <Fragment key={key}>{localize(content)}</Fragment>;
    }
    const children = node.content?.map(render);
    if (node.type === 'reportField')
      return (
        <span className="report-field-chip" key={key}>
          {localize(reportFieldLabel(node))}
        </span>
      );
    if (node.type === 'paragraph') return <p key={key}>{localize(children || <br />)}</p>;
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level);
      return level === 1 ? (
        <h1 key={key}>{localize(children)}</h1>
      ) : level === 2 ? (
        <h2 key={key}>{localize(children)}</h2>
      ) : (
        <h3 key={key}>{localize(children)}</h3>
      );
    }
    if (node.type === 'bulletList') return <ul key={key}>{localize(children)}</ul>;
    if (node.type === 'orderedList') return <ol key={key}>{localize(children)}</ol>;
    if (node.type === 'listItem') return <li key={key}>{localize(children)}</li>;
    if (node.type === 'blockquote')
      return <blockquote key={key}>{localize(children)}</blockquote>;
    if (node.type === 'codeBlock') return <pre key={key}>{localize(children)}</pre>;
    if (node.type === 'horizontalRule') return <hr key={key} />;
    if (node.type === 'hardBreak') return <br key={key} />;
    return <Fragment key={key}>{localize(children)}</Fragment>;
  }
  return <div className="report-paper">{localize(render(body, 0))}</div>;
}
