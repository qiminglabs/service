'use client';
import { useI18n } from '@/lib/i18n/context';


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
  const { localize, localizeList, localizeMessage } = useI18n();
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
          aria-label={localizeMessage("搜索预览{0}", [localize(objectLabel)])}
          placeholder={
            localize(flowId ? '搜索工单编号、服务名称或项目名称' : '搜索项目名称或编号')
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <NativeSelect
          aria-label={localizeMessage("选择预览{0}", [localize(objectLabel)])}
          value={selected}
          disabled={!projects || !options.length}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{localize("选择")}{localize(objectLabel)}{localize("预览")}</option>
          {localize(matches.map((option) => (
            <option key={option.key} value={option.key}>
              {localize(option.label)}
            </option>
          )))}
        </NativeSelect>
      </div>
      {localize(issue && (
        <p className="sr-error" role="alert">
          {localize(issue)}
        </p>
      ))}
      {localize(resolved?.missing.length ? (
        <p className="sr-help">
          {localize("未填写或无法匹配的字段：")}{localizeList(resolved.missing)}
        </p>
      ) : null)}
      {localize(resolved ? (
        <div
          className="report-data-preview-document"
          key={selected}
          role="region"
          aria-label={localizeMessage("{0}阅读预览", [localize(template.name)])}
          tabIndex={0}
        >
          <article
            className="report-template-reader"
            aria-label={localize(template.name)}
          >
            <ReportBody body={resolved.body} />
          </article>
        </div>
      ) : (
        !issue && (
          <p className="routing-empty">
            {localize(!projects
              ? '正在读取预览数据…'
              : !options.length
                ? flowId
                  ? '暂无使用此流程的工单'
                  : '暂无可预览的项目'
                : !matches.length
                  ? '暂无匹配的记录'
                  : localizeMessage("请选择{0}预览", [String(localize(objectLabel))]))}
          </p>
        )
      ))}
    </div>
  );
}
