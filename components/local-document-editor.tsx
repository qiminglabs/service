'use client';

import { useEffect, useState } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  ArrowLeft,
  FileText,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StoredFile } from '@/lib/service-requests';

type OnlineDocument = NonNullable<StoredFile['onlineDocument']>;
// Local SDK-style boundary: document in, change events out. No Tencent client or remote session.
export function LocalDocumentEditor({
  value,
  readonly,
  busy,
  dirty,
  onChange,
  onBack,
}: {
  value: OnlineDocument;
  readonly: boolean;
  busy: boolean;
  dirty: boolean;
  onChange: (value: OnlineDocument) => void;
  onBack: () => void;
}) {
  const [zoom, setZoom] = useState(100);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false })],
    immediatelyRender: false,
    editable: !readonly && !busy,
    content: value.richText ?? {
      type: 'doc',
      content: value.content.split('\n').map((line) => ({
        type: 'paragraph',
        ...(line ? { content: [{ type: 'text', text: line }] } : {}),
      })),
    },
    editorProps: {
      attributes: {
        'aria-label': '文档正文',
        role: 'textbox',
        'aria-multiline': 'true',
        spellcheck: 'false',
      },
    },
    onUpdate: ({ editor }) => {
      if (readonly || busy) return;
      onChange({
        ...value,
        content: editor.getText(),
        richText: editor.getJSON(),
      });
    },
  });
  useEffect(() => {
    editor?.setEditable(!readonly && !busy, false);
  }, [editor, readonly, busy]);
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) return null;
      const headings: { text: string; pos: number; level: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading')
          headings.push({
            text: node.textContent || '未命名标题',
            pos,
            level: node.attrs.level,
          });
      });
      return {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        bulletList: editor.isActive('bulletList'),
        orderedList: editor.isActive('orderedList'),
        blockquote: editor.isActive('blockquote'),
        heading: editor.isActive('heading')
          ? String(editor.getAttributes('heading').level)
          : '0',
        undo: editor.can().undo(),
        redo: editor.can().redo(),
        headings,
      };
    },
  });
  const tools = [
    {
      label: '撤销',
      icon: Undo2,
      run: () => editor?.chain().focus().undo().run(),
      disabled: !state?.undo,
    },
    {
      label: '重做',
      icon: Redo2,
      run: () => editor?.chain().focus().redo().run(),
      disabled: !state?.redo,
    },
    {
      label: '加粗',
      icon: Bold,
      run: () => editor?.chain().focus().toggleBold().run(),
      active: state?.bold,
    },
    {
      label: '斜体',
      icon: Italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
      active: state?.italic,
    },
    {
      label: '下划线',
      icon: Underline,
      run: () => editor?.chain().focus().toggleUnderline().run(),
      active: state?.underline,
    },
    {
      label: '删除线',
      icon: Strikethrough,
      run: () => editor?.chain().focus().toggleStrike().run(),
      active: state?.strike,
    },
    {
      label: '项目列表',
      icon: List,
      run: () => editor?.chain().focus().toggleBulletList().run(),
      active: state?.bulletList,
    },
    {
      label: '编号列表',
      icon: ListOrdered,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
      active: state?.orderedList,
    },
    {
      label: '引用',
      icon: Quote,
      run: () => editor?.chain().focus().toggleBlockquote().run(),
      active: state?.blockquote,
    },
    {
      label: '清除格式',
      icon: RemoveFormatting,
      run: () => editor?.chain().focus().unsetAllMarks().clearNodes().run(),
    },
  ];
  return (
    <section className="sr-doc-sdk" aria-label="在线文档编辑器（本地模拟）">
      <header className="sr-doc-topbar">
        <Button
          variant="ghost"
          size="icon"
          aria-label="返回材料"
          title="返回材料"
          disabled={busy}
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <FileText className="sr-doc-symbol" size={30} />
        <div className="sr-doc-title">
          <Input
            aria-label="文档名称"
            value={value.title}
            readOnly={readonly}
            disabled={busy}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
          <span>
            {readonly ? '只读文档' : dirty ? '有未保存的修改' : '已保存到本机'}
          </span>
        </div>
        <span className="sr-doc-simulation">腾讯文档风格 · 本地模拟</span>
      </header>
      <div className="sr-doc-toolbar" role="toolbar" aria-label="文档格式">
        <select
          aria-label="段落样式"
          value={state?.heading ?? '0'}
          disabled={readonly || busy || !editor}
          onChange={(e) => {
            const level = Number(e.target.value) as 1 | 2 | 3;
            if (level) editor?.chain().focus().setHeading({ level }).run();
            else editor?.chain().focus().setParagraph().run();
          }}
        >
          <option value="0">正文</option>
          <option value="1">标题 1</option>
          <option value="2">标题 2</option>
          <option value="3">标题 3</option>
        </select>
        <span className="sr-doc-toolbar-divider" />
        {tools.map((tool) => (
          <Button
            key={tool.label}
            size="icon-sm"
            variant="ghost"
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={tool.active}
            disabled={readonly || busy || !editor || tool.disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.run}
          >
            <tool.icon size={16} />
          </Button>
        ))}
      </div>
      <div className="sr-doc-workspace">
        <aside className="sr-doc-outline">
          <h4>文档目录</h4>
          {state?.headings.length ? (
            state.headings.map((heading) => (
              <button
                key={heading.pos}
                style={{ paddingLeft: (heading.level - 1) * 12 }}
                disabled={busy}
                onClick={() =>
                  editor
                    ?.chain()
                    .setTextSelection(heading.pos + 1)
                    .scrollIntoView()
                    .run()
                }
              >
                {heading.text}
              </button>
            ))
          ) : (
            <p>设置标题后显示目录</p>
          )}
        </aside>
        <div className="sr-doc-canvas">
          <div className="sr-doc-paper" style={{ zoom: zoom / 100 }}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      <footer className="sr-doc-status">
        <span>{value.content.replace(/\s/g, '').length} 字</span>
        <span>{readonly ? '只读' : '编辑模式'}</span>
        <label>
          缩放
          <select
            aria-label="文档缩放"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={75}>75%</option>
            <option value={100}>100%</option>
            <option value={125}>125%</option>
          </select>
        </label>
      </footer>
    </section>
  );
}
