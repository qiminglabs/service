'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { FlowDictionary, ServiceFlowRule } from '@/lib/service-flows';

type Scope = NonNullable<ServiceFlowRule['serviceScope']>;
export function ServiceFlowScopeSelect({
  value = { mode: 'all', serviceIds: [] },
  dictionary,
  onChange,
}: {
  value?: Scope;
  dictionary: FlowDictionary;
  onChange: (scope: Scope) => void;
}) {
  const [query, setQuery] = useState('');
  const options = [
    ...value.serviceIds
      .filter((id) => !dictionary.services.some((service) => service.id === id))
      .map((id) => ({ id, name: '已不存在的服务目录' })),
    ...dictionary.services,
  ];
  const matches = options.filter((service) =>
    `${service.name} ${service.id}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div
      className="submission-rule-field"
      role="group"
      aria-label="适用服务目录"
    >
      <label className="submission-rule-field">
        <span>适用服务目录</span>
        <NativeSelect
          value={value.mode}
          onChange={(event) =>
            onChange({
              mode: event.target.value as Scope['mode'],
              serviceIds: [],
            })
          }
        >
          <option value="all">全部服务目录</option>
          <option value="selected">指定服务目录（可多选）</option>
        </NativeSelect>
      </label>
      {value.mode === 'selected' && (
        <>
          <Input
            aria-label="搜索适用服务目录"
            placeholder="搜索服务目录名称或编号"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="service-flow-scope-options">
            {matches.map((service) => (
              <label key={service.id}>
                <input
                  type="checkbox"
                  checked={value.serviceIds.includes(service.id)}
                  onChange={(event) =>
                    onChange({
                      mode: 'selected',
                      serviceIds: event.target.checked
                        ? [...value.serviceIds, service.id]
                        : value.serviceIds.filter((id) => id !== service.id),
                    })
                  }
                />
                <span>
                  {service.name}
                  <small>{service.id}</small>
                </span>
              </label>
            ))}
            {!matches.length && <p className="sr-help">没有匹配的服务目录。</p>}
          </div>
          <p className="sr-help">
            已选择 {value.serviceIds.length}{' '}
            个服务目录。选中任意一个即可进入条件匹配。
          </p>
          {!!value.serviceIds.length && (
            <p className="sr-help">
              {value.serviceIds
                .map(
                  (id) =>
                    options.find((service) => service.id === id)?.name ?? id,
                )
                .join('、')}
            </p>
          )}
        </>
      )}
      <p className="sr-help">
        先匹配服务目录，再判断自然语言条件；更改目录范围后需重新测试。
      </p>
    </div>
  );
}
