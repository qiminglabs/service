import { Node, mergeAttributes } from '@tiptap/react';
export const ReportFieldExtension = Node.create({
  name: 'reportField',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      id: { default: '' },
      label: { default: '' },
      scope: { default: 'project' },
      fieldId: { default: '' },
      formId: { default: null },
      stepId: { default: null },
      emptyPolicy: { default: null },
      defaultText: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-report-field]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-report-field': '',
        class: 'report-field-chip',
        contenteditable: 'false',
      }),
      String(node.attrs.label),
    ];
  },
  renderText({ node }) {
    return `【${node.attrs.label}】`;
  },
});
