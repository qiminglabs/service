import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';

// Node's TS runner requires extensions; the application resolves these through Vite.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './service-requests') specifier += '.ts';
    if (specifier === 'mammoth/mammoth.browser') specifier += '.js';
    return next(specifier, context);
  },
});
const { canEditTemplate, onlineMaterialFile, templateText } =
  await import('./online-material.ts');

test('online document stores real bytes, editable content and safe filename', async () => {
  const file = onlineMaterialFile({
    title: '客户/移交材料',
    content: '节点：3\n网络已准备',
    source: 'blank',
  });
  assert.equal(file.name, '客户_移交材料.txt');
  assert.equal(await file.blob.text(), file.onlineDocument.content);
  const copy = structuredClone(file);
  assert.equal(await copy.blob.text(), file.onlineDocument.content);
  assert.equal(copy.onlineDocument.source, 'blank');
});

test('empty and oversized online documents are rejected', () => {
  assert.throws(() =>
    onlineMaterialFile({ title: '', content: '正文', source: 'blank' }),
  );
  assert.throws(() =>
    onlineMaterialFile({ title: '材料', content: '  ', source: 'blank' }),
  );
  assert.throws(() =>
    onlineMaterialFile({
      title: '材料',
      content: 'a'.repeat(20 * 1024 * 1024 + 1),
      source: 'blank',
    }),
  );
});
test('rich-text document formatting survives local storage cloning and can be reopened', async () => {
  const { getSchema } = await import('@tiptap/react');
  const { default: StarterKit } = await import('@tiptap/starter-kit');
  const richText = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: '客户环境' }],
      },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '三个节点',
            marks: [{ type: 'bold' }, { type: 'underline' }],
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '网络已就绪' }],
              },
            ],
          },
        ],
      },
    ],
  };
  const file = onlineMaterialFile({
    title: '移交材料',
    content: '客户环境\n三个节点\n网络已就绪',
    source: 'template',
    richText,
  });
  const restored = structuredClone(file);
  const schema = getSchema([StarterKit.configure({ link: false })]);
  const doc = schema.nodeFromJSON(restored.onlineDocument.richText);
  doc.check();
  assert.equal(doc.firstChild.type.name, 'heading');
  assert.equal(doc.child(1).firstChild.marks[0].type.name, 'bold');
  assert.equal(doc.child(2).type.name, 'bulletList');
  assert.deepEqual(restored.onlineDocument.richText, richText);
  assert.equal(await restored.blob.text(), file.onlineDocument.content);
});

test('configured plain-text template is used verbatim', async () => {
  const body = '# 自定义模板\n请填写真实节点数：\n';
  assert.equal(await templateText(new Blob([body]), 'custom.md'), body);
});

test('actual handover Word template can be opened as editable text', async () => {
  const bytes = await readFile(
    new URL('../public/templates/handover-template.docx', import.meta.url),
  );
  const body = await templateText(new Blob([bytes]), 'handover.docx');
  assert.ok(body.length > 100);
  assert.match(body, /客户/);
});

test('unsupported, empty and corrupt templates fail without a fake fallback', async () => {
  assert.equal(canEditTemplate('template.DOCX'), true);
  assert.equal(canEditTemplate('template.pdf'), false);
  await assert.rejects(templateText(new Blob(['text']), 'template.pdf'));
  await assert.rejects(templateText(new Blob(['  ']), 'empty.md'));
  await assert.rejects(templateText(new Blob(['not a zip']), 'broken.docx'));
});
