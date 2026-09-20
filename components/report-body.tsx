import { Fragment, type ReactNode } from 'react';
import { reportFieldLabel, type ReportNode } from '@/lib/report-templates';
export function ReportBody({ body }: { body: ReportNode }) {
  function render(node: ReportNode, key: number): ReactNode {
    if (node.type === 'text') {
      let content: ReactNode = node.text;
      for (const m of node.marks ?? []) {
        if (m.type === 'bold') content = <strong>{content}</strong>;
        if (m.type === 'italic') content = <em>{content}</em>;
        if (m.type === 'underline') content = <u>{content}</u>;
        if (m.type === 'strike') content = <s>{content}</s>;
        if (m.type === 'code') content = <code>{content}</code>;
      }
      return <Fragment key={key}>{content}</Fragment>;
    }
    const children = node.content?.map(render);
    if (node.type === 'reportField')
      return (
        <span className="report-field-chip" key={key}>
          {reportFieldLabel(node)}
        </span>
      );
    if (node.type === 'paragraph') return <p key={key}>{children || <br />}</p>;
    if (node.type === 'heading') {
      const level = Number(node.attrs?.level);
      return level === 1 ? (
        <h1 key={key}>{children}</h1>
      ) : level === 2 ? (
        <h2 key={key}>{children}</h2>
      ) : (
        <h3 key={key}>{children}</h3>
      );
    }
    if (node.type === 'bulletList') return <ul key={key}>{children}</ul>;
    if (node.type === 'orderedList') return <ol key={key}>{children}</ol>;
    if (node.type === 'listItem') return <li key={key}>{children}</li>;
    if (node.type === 'blockquote')
      return <blockquote key={key}>{children}</blockquote>;
    if (node.type === 'codeBlock') return <pre key={key}>{children}</pre>;
    if (node.type === 'horizontalRule') return <hr key={key} />;
    if (node.type === 'hardBreak') return <br key={key} />;
    return <Fragment key={key}>{children}</Fragment>;
  }
  return <div className="report-paper">{render(body, 0)}</div>;
}
