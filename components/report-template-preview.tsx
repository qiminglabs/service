'use client';

import { useEffect, useState } from 'react';
import { ReportBody } from '@/components/report-body';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { readServiceProjects } from '@/lib/service-project-store';
import {
  reportPreviewOrders,
  renderWorkOrderPreview,
} from '@/lib/report-template-preview';
import { renderReport, type ReportTemplate } from '@/lib/report-templates';
import type { OperationActor } from '@/lib/request-operations';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { CustomerRef } from '@/lib/service-requests';

export function ReportTemplatePreview({
  actor,
  template,
  flowId,
  customers,
}: {
  actor: OperationActor;
  template: ReportTemplate;
  flowId?: string;
  customers: CustomerRef[];
}) {
  const [projects, setProjects] = useState<ServiceProjectRecord[]>();
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setProjects(undefined);
    setSelected('');
    setError('');
    void readServiceProjects(actor)
      .then((rows) => {
        if (active) setProjects(rows);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : '预览数据读取失败。',
          );
      });
    return () => {
      active = false;
    };
  }, [actor.id, actor.role]);
  const options = flowId
    ? reportPreviewOrders(projects ?? [], flowId).map((row) => ({
        key: row.key,
        project: row.project,
        orderId: row.order.id,
        label: `${row.order.id} · ${row.order.item.serviceName} · ${row.project.name}`,
      }))
    : (projects ?? []).map((project) => ({
        key: project.id,
        project,
        orderId: undefined,
        label: `${project.name} · ${project.id}`,
      }));
  const current = options.find((option) => option.key === selected);
  const matches = options.filter(
    (option) =>
      option.key === selected ||
      option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  let resolved: ReturnType<typeof renderReport> | undefined;
  let issue = error;
  if (current) {
    try {
      const customerName = customers.find(
        (customer) => customer.id === current.project.customerId,
      )?.name;
      resolved =
        flowId && current.orderId
          ? renderWorkOrderPreview(
              template,
              current.project,
              current.orderId,
              customerName,
            )
          : renderReport(template, { project: current.project, customerName });
    } catch (cause) {
      issue = cause instanceof Error ? cause.message : '预览生成失败。';
    }
  }
  const objectLabel = flowId ? '工单' : '项目';
  return (
    <div className="report-data-preview">
      <div className="report-data-preview-toolbar">
        <Input
          aria-label={`搜索预览${objectLabel}`}
          placeholder={
            flowId ? '搜索工单编号、服务名称或项目名称' : '搜索项目名称或编号'
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <NativeSelect
          aria-label={`选择预览${objectLabel}`}
          value={selected}
          disabled={!projects || !options.length}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">选择{objectLabel}预览</option>
          {matches.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      {issue && (
        <p className="sr-error" role="alert">
          {issue}
        </p>
      )}
      {resolved?.missing.length ? (
        <p className="sr-help">
          未填写或无法匹配的字段：{resolved.missing.join('、')}
        </p>
      ) : null}
      {resolved ? (
        <div
          className="report-data-preview-document"
          key={selected}
          role="region"
          aria-label={`${template.name}阅读预览`}
          tabIndex={0}
        >
          <article
            className="report-template-reader"
            aria-label={template.name}
          >
            <ReportBody body={resolved.body} />
          </article>
        </div>
      ) : (
        !issue && (
          <p className="routing-empty">
            {!projects
              ? '正在读取预览数据…'
              : !options.length
                ? flowId
                  ? '暂无使用此流程的工单'
                  : '暂无可预览的项目'
                : !matches.length
                  ? '暂无匹配的记录'
                  : `请选择${objectLabel}预览`}
          </p>
        )
      )}
    </div>
  );
}
