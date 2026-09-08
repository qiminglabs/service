'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogHeader,
  DialogDescription,
} from '@/components/ui/dialog';
import { readLocal, defaultConfig, downloadFile } from '@/lib/service-requests';
import type { RequestConfig } from '@/lib/service-requests';
import type { CatalogVersion, VersionedService } from '@/lib/catalog-versions';

const labels: Record<string, string> = {
  id: '服务编码',
  version: '版本号',
  name: '服务名称',
  category: '服务类别',
  description: '服务说明',
  deliveryMethods: '支持服务方式',
  priceUnit: '计价单位',
  priceCoefficient: '计价系数',
  defaultQuantity: '默认计价数量',
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
  return (
    <section className="detail-card">
      <h3>{title}</h3>
      <p>
        需求说明：
        {config.basicFields?.description?.enabled === false
          ? '不显示'
          : config.basicFields?.description?.required === false
            ? '选填'
            : '必填'}
      </p>
      <p>
        业务对象：
        {config.basicFields?.businessObjects?.enabled === false
          ? '不显示'
          : config.basicFields?.businessObjects?.required
            ? '必填'
            : '选填'}
        ；可搜索产品：
        {config.basicFields?.businessObjects?.products?.join('、') ?? '不限'}
      </p>
      {config.fields.map((id) => (
        <p key={id}>
          {config.fieldNames?.[id] ?? id}：
          {config.fieldRequired?.[id] === false ? '选填' : '必填'}
          {config.fieldOptions?.[id]
            ? `；可用选项：${config.fieldOptions[id].join('、')}`
            : ''}
        </p>
      ))}
      <h4>材料要求</h4>
      {config.materials.map((material) => (
        <div key={material.id}>
          <strong>
            {material.name}（{material.required ? '必填' : '选填'}）
          </strong>
          <p>{material.instructions}</p>
          {material.template ? (
            <Button
              variant="link"
              onClick={() => downloadFile(material.template!)}
            >
              下载历史模板：{material.template.name}
            </Button>
          ) : material.templateUrl ? (
            <a href={material.templateUrl} download>
              下载模板
            </a>
          ) : null}
          {/^https?:\/\//i.test(material.onlineTemplateUrl ?? '') && (
            <a
              href={material.onlineTemplateUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {' '}
              打开在线模板
            </a>
          )}
        </div>
      ))}
    </section>
  );
}
export function CatalogHistory({ serviceId }: { serviceId: string }) {
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
        历史版本
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          style={{
            maxWidth: 1000,
            width: '90vw',
            maxHeight: '85vh',
            overflowY: 'auto',
          }}
        >
          <DialogHeader>
            <DialogTitle>服务目录历史版本</DialogTitle>
            <DialogDescription>
              只读查看目录及两套申请配置。在线链接保留历史地址，外部文档内容由文档平台管理。
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <select
            aria-label="选择历史版本"
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {entries.map((entry, i) => (
              <option key={i} value={i}>
                v{entry.service.version} · {entry.reason} · {entry.savedAt}
              </option>
            ))}
          </select>
          {selected && (
            <>
              <section className="detail-card">
                <h3>目录信息</h3>
                <dl>
                  {Object.entries(selected.service).map(([key, value]) => (
                    <div key={key}>
                      <dt>{labels[key] ?? key}</dt>
                      <dd>
                        {Array.isArray(value)
                          ? value.join('、')
                          : typeof value === 'string' ||
                              typeof value === 'number'
                            ? value
                            : JSON.stringify(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <ConfigSnapshot title="内部申请配置" config={selected.internal} />
              <ConfigSnapshot
                title="客户中心申请配置"
                config={selected.customer}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
