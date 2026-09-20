import type { Partner } from './partner-directory';

export const serviceProviderSettingsId = 'service-provider-settings';
export type ServiceProviderEntry = {
  partnerId: string;
  enabled: boolean;
  updatedAt: string;
  updatedBy: string;
};
export type ServiceProviderConfig = { revision: number; entries: ServiceProviderEntry[] };

export class ServiceProviderConflict extends Error {
  constructor() { super('服务商配置已变更，列表已更新，请核对后重新操作。'); }
}

export function parseServiceProviderConfig(value: unknown): ServiceProviderConfig {
  if (value === undefined) return { revision: 0, entries: [] };
  const config = value as ServiceProviderConfig | null;
  if (!config || !Number.isSafeInteger(config.revision) || config.revision < 0 || !Array.isArray(config.entries)) throw new Error('服务商配置数据异常，无法读取。');
  const ids = new Set<string>();
  for (const entry of config.entries) {
    if (!entry || typeof entry.partnerId !== 'string' || !entry.partnerId || ids.has(entry.partnerId) || typeof entry.enabled !== 'boolean' || typeof entry.updatedAt !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt)) || typeof entry.updatedBy !== 'string') throw new Error('服务商配置数据异常，无法读取。');
    ids.add(entry.partnerId);
  }
  return structuredClone(config);
}

export function changeServiceProvider(config: ServiceProviderConfig, partners: Partner[], partnerId: string, enabled: boolean, expectedRevision: number, actorName: string, now = new Date().toISOString()): ServiceProviderConfig {
  if (config.revision !== expectedRevision) throw new ServiceProviderConflict();
  const partner = partners.find(company => company.id === partnerId);
  if (!partner) throw new Error('该企业已不存在，请重新进入服务商管理。');
  if (enabled && partner.status !== '启用') throw new Error('该企业已停用，不能设为服务商。');
  if (typeof enabled !== 'boolean') throw new Error('服务商状态无效。');
  return {
    revision: config.revision + 1,
    entries: [...config.entries.filter(entry => entry.partnerId !== partnerId), { partnerId, enabled, updatedAt: now, updatedBy: actorName }],
  };
}
