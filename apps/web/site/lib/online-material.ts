import { checkFile, storedFile } from './service-requests';
import type { StoredFile } from './service-requests';

export function onlineMaterialFile(
  document: NonNullable<StoredFile['onlineDocument']>,
): StoredFile {
  if (!document.title.trim()) throw new Error('请填写文件名称。');
  if (!document.content.trim()) throw new Error('请填写文件正文。');
  const name =
    document.title
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\.(txt|md)$/i, '') + '.txt';
  const file = new File([document.content], name, {
    type: 'text/plain;charset=utf-8',
  });
  const problem = checkFile(file);
  if (problem) throw new Error(problem);
  return {
    ...storedFile(file),
    onlineDocument: { ...document, title: document.title.trim() },
  };
}

export function canEditTemplate(name: string) {
  return /\.(docx|txt|md)$/i.test(name);
}

export async function templateText(blob: Blob, name: string): Promise<string> {
  if (!canEditTemplate(name))
    throw new Error(
      '该格式暂不支持提取正文，请下载模板填写后上传，或从空白开始填写。',
    );
  if (!blob.size || blob.size > 20 * 1024 * 1024)
    throw new Error('模板为空或超过 20 MB，请检查目录模板配置。');
  if (/\.docx$/i.test(name)) {
    const mammoth = await import('mammoth/mammoth.browser');
    const result = await mammoth.extractRawText({
      arrayBuffer: await blob.arrayBuffer(),
    });
    if (!result.value.trim())
      throw new Error('模板没有可编辑的文字，请下载原文件填写后上传。');
    return result.value;
  }
  const content = await blob.text();
  if (!content.trim())
    throw new Error('模板没有可编辑的文字，请检查目录模板。');
  return content;
}
