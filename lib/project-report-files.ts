import type { StoredFile } from './service-requests';
import type { ServiceProjectRecord } from './service-projects';
import { projectDeliverables } from './service-project-deliverables.ts';

export type ProjectReportFileSelection = {
  deliverableId: string;
  description: string;
};
export type ProjectReportFile = {
  id: string;
  description: string;
  file: StoredFile;
};
export const maxProjectReportFiles = 100;
export const maxProjectReportFileDescription = 2000;

export function resolveProjectReportFiles(
  project: Pick<ServiceProjectRecord, 'workOrders'>,
  selections: ProjectReportFileSelection[],
): ProjectReportFile[] {
  if (!Array.isArray(selections) || selections.length > maxProjectReportFiles)
    throw new Error(`项目报告最多选择 ${maxProjectReportFiles} 个文件。`);
  const available = projectDeliverables(project);
  const seen = new Set<string>();
  return selections.map((selection) => {
    if (
      !selection ||
      typeof selection.deliverableId !== 'string' ||
      seen.has(selection.deliverableId)
    )
      throw new Error('项目文件选择无效或重复。');
    seen.add(selection.deliverableId);
    if (
      typeof selection.description !== 'string' ||
      selection.description.length > maxProjectReportFileDescription
    )
      throw new Error(
        `文件说明不能超过 ${maxProjectReportFileDescription} 字。`,
      );
    const source = available.find(
      (item) => item.id === selection.deliverableId,
    );
    if (!source)
      throw new Error(
        '所选文件已不存在或不再属于客户交付物，请重新选择项目文件。',
      );
    if (
      !(source.file.blob instanceof Blob) ||
      !source.file.blob.size ||
      source.file.blob.size > 20 * 1024 * 1024
    )
      throw new Error('所选项目文件无效或超过 20 MB。');
    return {
      id: source.id,
      description: selection.description.trim(),
      file: structuredClone(source.file),
    };
  });
}

export function projectReportFilesText(files: ProjectReportFile[]) {
  return [
    '项目文件',
    ...files.map(
      (item, index) =>
        `${index + 1}. ${item.file.name}${item.description ? `\n文件说明：${item.description}` : ''}`,
    ),
    ...(files.length ? [] : ['暂无项目文件']),
  ].join('\n');
}

export function customerProjectReportFiles(files: ProjectReportFile[]) {
  return files.map((item) => ({
    id: item.id,
    description: item.description,
    file: {
      id: item.file.id,
      name: item.file.name,
      size: item.file.size,
      uploadedAt: item.file.uploadedAt,
      blob: item.file.blob,
    },
  }));
}
