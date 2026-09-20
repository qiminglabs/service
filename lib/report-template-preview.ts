import type { ServiceProjectRecord } from './service-projects';
import {
  defaultReportBindings,
  renderReport,
  type ReportTemplate,
} from './report-templates.ts';

export function reportPreviewOrders(
  projects: ServiceProjectRecord[],
  flowId: string,
) {
  return projects.flatMap((project) =>
    (project.workOrders ?? [])
      .filter((order) => order.flowId === flowId && order.status !== '已取消')
      .map((order) => ({
        key: JSON.stringify([project.id, order.id]),
        project,
        order,
      })),
  );
}

export function renderWorkOrderPreview(
  template: ReportTemplate,
  project: ServiceProjectRecord,
  orderId: string,
  customerName?: string,
) {
  const order = project.workOrders?.find(
    (order) => order.id === orderId && order.status !== '已取消',
  );
  if (!order || template.flowId !== order.flowId)
    throw new Error('请选择使用当前流程的有效工单。');
  return renderReport(
    template,
    { project, orderId, customerName },
    defaultReportBindings(
      template,
      order.steps.map((step) => step.definition),
    ),
  );
}
