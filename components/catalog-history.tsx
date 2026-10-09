'use client';
import { useI18n } from '@/lib/i18n/context';

import { translateMaterialRequirement } from '@/lib/i18n/materials';
import { fieldRequirementLabels } from '@/lib/request-field-requirements';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { readLocal, defaultConfig, downloadFile } from '@/lib/service-requests';
import type { RequestConfig } from '@/lib/service-requests';
import type { CatalogVersion, VersionedService } from '@/lib/catalog-versions';

function historyTime(value: string) {
  if (!value) return '时间未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replaceAll('/', '-');
}

const labels: Record<string, string> = {
  id: '服务编码',
  version: '版本号',
  name: '服务名称',
  category: '服务类别',
  description: '服务说明',
  deliveryMethods: '支持服务方式',
  priceUnit: '计价单位',
  priceCoefficient: '计价系数',
  defaultQuantity: '最小人天数量',
  certifications: '认证要求',
  providers: '支持服务方',
  allowedInitiatorSites: '可发起站点',
  internalNote: '内部备注',
  status: '状态',
  owner: '修改人',
  updatedAt: '更新时间',
};
function ConfigSnapshot({
  config,
  title,
}: {
  config: RequestConfig;
  title: string;
}) {
  const { localize, localizeList, localizeMessage, locale, labels: translationLabels } = useI18n();
  return (
    <section className="detail-card">
      <h3>{localize(title)}</h3>
      <p>
        {localizeMessage('需求说明：{0}', [localize(config.basicFields?.description?.enabled === false
          ? '不显示' : config.basicFields?.description?.required === false ? '选填' : '必填')])}
      </p>
      <p>
        {localizeMessage('业务对象：{0}；可搜索产品：{1}', [
          localize(config.basicFields?.businessObjects?.enabled === false
            ? '不显示' : config.basicFields?.businessObjects?.required ? '必填' : '选填'),
          config.basicFields?.businessObjects?.products
            ? localizeList(config.basicFields.businessObjects.products) : localize('不限'),
        ])}
      </p>
      {config.fields.map((id) => {
        const name = localize(config.fieldNames?.[id] ?? id);
        const requirement = localize(config.fieldRequiredWhen?.[id]
          ? fieldRequirementLabels[config.fieldRequiredWhen[id]]
          : config.fieldRequired?.[id] === false ? '选填' : '必填');
        const options = config.fieldOptions?.[id];
        return <p key={id}>{options?.length
          ? localizeMessage('{0}：{1}；可用选项：{2}', [name, requirement, localizeList(options)])
          : localizeMessage('{0}：{1}', [name, requirement])}</p>;
      })}
      <h4>{localize("材料要求")}</h4>
      {localize(config.materials.map((material) => (
        <div key={material.id}>
          <strong>
            {localizeMessage('{0}（{1}）', [localize(material.name), translateMaterialRequirement(material, locale, translationLabels)])}
          </strong>
          <p>{localize(material.instructions)}</p>
          {localize(material.template ? (
            <Button
              variant="link"
              onClick={() => downloadFile(material.template!)}
            >
              {localize("下载历史模板：")}{localize(material.template.name)}
            </Button>
          ) : material.templateUrl ? (
            <a href={material.templateUrl} download>
              {localize("下载模板")}</a>
          ) : null)}
          {localize(/^https?:\/\//i.test(material.onlineTemplateUrl ?? '') && (
            <a
              href={material.onlineTemplateUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {localize(' ')}
              {localize("打开在线模板")}</a>
          ))}
        </div>
      )))}
    </section>
  );
}
export function CatalogHistory({ serviceId }: { serviceId: string }) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CatalogVersion['payload'][]>([]);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const selected = entries[index];
  return (
    <>
      <Button
        variant="outline"
        className="ct-button ct-button--ordinary"
        onClick={async () => {
          setError('');
          setEntries([]);
          setOpen(true);
          try {
            const records = await readLocal<{ id: string; payload: unknown }>(
              'references',
            );
            let history = records.find(
              (record) => record.id === `catalog-history:${serviceId}`,
            )?.payload as CatalogVersion['payload'][] | undefined;
            if (!history?.length) {
              const workspace = records.find(
                (record) => record.id === 'workspace',
              )?.payload as { services: VersionedService[] } | undefined;
              const service = workspace?.services.find(
                (s) => s.id === serviceId,
              );
              if (!service) throw new Error('目录尚未保存');
              const configs = await readLocal<RequestConfig>('configs');
              history = [
                {
                  service: { ...service, version: service.version ?? 1 },
                  internal:
                    configs.find((c) => c.serviceId === serviceId) ??
                    defaultConfig(service),
                  customer:
                    (records.find(
                      (r) => r.id === `customer-request-config:${serviceId}`,
                    )?.payload as RequestConfig | undefined) ??
                    defaultConfig(service),
                  savedAt: service.updatedAt ?? '',
                  partner: records.find(r => r.id === `partner-request-config:${serviceId}`)?.payload as RequestConfig | undefined,
                  reason: '当前初始版本',
                },
              ];
            }
            setEntries(history);
            setIndex(history.length - 1);
          } catch {
            setError('历史版本读取失败，请重试。');
          }
        }}
      >
        {localize("历史版本")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="catalog-history-dialog">
          <DialogHeader>
            <DialogTitle>{localize("服务目录历史版本")}</DialogTitle>
            <DialogDescription>
              {localize("在线链接保留历史地址，外部文档内容由文档平台管理。")}</DialogDescription>
          </DialogHeader>
          <div className="catalog-history-toolbar">
            <span id="catalog-history-version-label">{localize("查看版本")}</span>
            <Select value={String(index)} onValueChange={value => { if (value !== null) setIndex(Number(value)); }} disabled={!entries.length}>
              <SelectTrigger aria-labelledby="catalog-history-version-label" className="catalog-history-select">
                <SelectValue>{localize(selected ? localizeMessage("v{0} · {1}", [String(localize(selected.service.version ?? 1)), String(localize(historyTime(selected.savedAt)))]) : '读取版本中…')}</SelectValue>
              </SelectTrigger>
              <SelectContent className="catalog-history-select-popup" align="start" alignItemWithTrigger={false}>
                {localize(entries.map((entry, i) => <SelectItem key={i} value={String(i)}>
                  <span className="catalog-history-option"><strong>v{localize(entry.service.version ?? 1)} · {localize(historyTime(entry.savedAt))}</strong></span>
                </SelectItem>).reverse())}
              </SelectContent>
            </Select>
          </div>
          <div className="catalog-history-body">
          {localize(error && <p role="alert" className="sr-error">{localize(error)}</p>)}
          {localize(!selected && !error && <output>{localize("正在读取历史版本…")}</output>)}
          {localize(selected && (
            <>
              <p className="catalog-history-meta">{localizeMessage('保存时间：{0}（北京时间）', [historyTime(selected.savedAt)])}</p>
              <section className="detail-card">
                <h3>{localize("目录信息")}</h3>
                <dl>
                  {localize(Object.entries(selected.service).map(([key, value]) => (
                    <div key={key}>
                      <dt>{localize(labels[key] ?? key)}</dt>
                      <dd>
                        {localize(key === 'updatedAt' && typeof value === 'string' ? historyTime(value) : key === 'version' ? localizeMessage("v{0}", [String(localize(String(value)))]) : Array.isArray(value)
                          ? localizeList(value, '、')
                          : typeof value === 'string' ||
                              typeof value === 'number'
                            ? value
                            : JSON.stringify(value))}
                      </dd>
                    </div>
                  )))}
                </dl>
              </section>
              <ConfigSnapshot title={localize("内部申请表单")} config={selected.internal} />
              <ConfigSnapshot
                title={localize("客户中心申请表单")}
                config={selected.customer}
              />
              {localize(selected.partner ? <ConfigSnapshot title={localize("合作伙伴中心申请表单")} config={selected.partner} /> : <section className="detail-card"><h3>{localize("合作伙伴中心申请表单")}</h3><p>{localize("该历史版本未记录合作伙伴中心申请表单。")}</p></section>)}
            </>
          ))}
          </div>
          <DialogFooter className="catalog-history-footer"><Button variant="outline" className="ct-button ct-button--ordinary" onClick={() => setOpen(false)}>{localize("关闭")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
