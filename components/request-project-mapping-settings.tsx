'use client';
import { useI18n } from '@/lib/i18n/context';

import type { RequestField } from '@/components/request-field-settings';
import { compatibleMappingFields } from '@/lib/custom-field-mapping';
import { normalizeApplicationFields } from '@/lib/request-application-fields';
import { normalizeProjectFields, isSystemProjectField } from '@/lib/service-project-fields';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { OperationActor } from '@/lib/request-operations';
import { canManageRouting } from '@/lib/assessment-routing-store';
import { defaultProjectMapping, mappingRules, type RequestProjectMapping, type MappingSection } from '@/lib/request-project-mapping';
import { readProjectMapping, saveProjectMapping } from '@/lib/request-project-mapping-store';

const groups = [
  { section: '请求字段', source: '服务请求', target: '服务项目' },
] as const;

export function RequestProjectMappingSettings({ actor, applicationFields, projectFields }: { actor: OperationActor; applicationFields: RequestField[]; projectFields: RequestField[] }) {
  const { localize, localizeMessage } = useI18n();
  const [config, setConfig] = useState<RequestProjectMapping>(defaultProjectMapping);
  const [ready, setReady] = useState(false);
  const [savingSection, setSavingSection] = useState<MappingSection | null>(null);
  const busy = savingSection !== null;
  const saveLock = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const customTargets = normalizeProjectFields(projectFields).filter(field => !isSystemProjectField(field.id));
  const customSources = normalizeApplicationFields(applicationFields);
  const allowed = canManageRouting(actor);
  useEffect(() => {
    let active = true;
    readProjectMapping().then(result => { if (active) { setConfig(result); setReady(true); } }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '无法读取映射。'); });
    return () => { active = false; };
  }, []);
  async function save(section: MappingSection) {
    if (saveLock.current) return;
    saveLock.current = true;
    setSavingSection(section); setError(''); setNotice('');
    try {
      const input = section === '请求字段' ? { ...config, customFields: (config.customFields ?? []).filter(mapping => customTargets.some(field => field.id === mapping.target.id)).map(mapping => ({ ...mapping, source: customSources.find(field => field.id === mapping.source.id) ?? mapping.source, target: customTargets.find(field => field.id === mapping.target.id)! })) } : { ...config };
      const saved = await saveProjectMapping(input, actor, section);
      setConfig(current => ({ ...current, ...(section === '请求字段' ? { customFields: saved.customFields } : {}), revision: saved.revision, updatedAt: saved.updatedAt, updatedBy: saved.updatedBy }));
      setNotice(`${groups.find(group => group.section === section)?.target}映射及只读设置已保存，将应用于之后创建的项目。`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { setSavingSection(null); saveLock.current = false; }
  }
  return <div className="sr-project-mapping-settings">
    {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
    {localize(notice && <output className="sr-mapping-notice">{localize(notice)}</output>)}
    {localize(!allowed && <p>{localize("仅系统管理员可修改映射配置。")}</p>)}
    <div className="sr-mapping-object-list">{localize(groups.map(({ section, source, target }) => <section className="sr-mapping-object" key={section} aria-label={localizeMessage("{0}到{1}映射", [localize(source), localize(target)])}>
      <div className="sr-mapping-object-header"><div><h4>{localize(source)}<ArrowRight size={16} aria-hidden="true" />{localize(target)}</h4></div>{localize(section === '请求字段' && <div className="sr-project-mapping-actions"><Button aria-label={localizeMessage("保存{0}映射", [localize(target)])} disabled={!ready || busy || !allowed} onClick={() => void save(section)}>{localize(savingSection === section ? '保存中…' : '保存映射')}</Button></div>)}</div>
      <div className="table-scroll"><table className="sr-project-mapping-table"><colgroup><col className="sr-mapping-source-col" /><col className="sr-mapping-arrow-col" /><col />{localize(section === '请求字段' && <col className="sr-mapping-readonly-col" />)}</colgroup><thead><tr><th scope="col">{localize("来源字段 / 固定值")}</th><th scope="col" aria-label={localize("映射到")} /><th scope="col">{localize("目标字段")}</th>{localize(section === '请求字段' && <th scope="col">{localize("转换后只读")}</th>)}</tr></thead><tbody>{localize(mappingRules.filter(rule => rule.section === section).map(rule => <tr key={rule.target}>
        <td>{localize(rule.sources.length === 1 ? <span className="sr-mapping-fixed-source">{localize(rule.sources[0][1])}</span> : <select aria-label={localizeMessage("{0}映射来源", [localize(rule.label)])} value={config.fields[rule.target]} disabled={!ready || busy || !allowed} onChange={event => { const value = event.target.value; setConfig(current => ({ ...current, fields: { ...current.fields, [rule.target]: value }, ...(!value ? { readonly: { ...current.readonly, [rule.target]: false } } : {}) })); setNotice(''); }}>{localize(rule.sources.map(([value, label]) => <option key={value} value={value}>{localize(label)}</option>))}</select>)}</td>
        <td><ArrowRight size={15} aria-hidden="true" /></td><td>{localize(rule.label)}</td>
        {localize(section === '请求字段' && <td>{localize(rule.target === 'customerId' ? <span className="sr-mapping-fixed-source">{localize("系统固定")}</span> : <div className="sr-mapping-readonly"><Switch aria-label={localizeMessage("{0}转换后只读", [localize(rule.label)])} checked={!!config.fields[rule.target] && config.readonly?.[rule.target] === true} disabled={!ready || busy || !allowed || !config.fields[rule.target]} onCheckedChange={checked => { setConfig(current => ({ ...current, readonly: { ...current.readonly, [rule.target]: checked } })); setNotice(''); }} /><span>{localize(!config.fields[rule.target] ? '未映射' : config.readonly?.[rule.target] ? '只读' : '可编辑')}</span></div>)}</td>)}
      </tr>))}{localize(section === '请求字段' && customTargets.map(targetField => {
        const entry = config.customFields?.find(mapping => mapping.target.id === targetField.id);
        const sources = customSources.filter(sourceField => compatibleMappingFields(sourceField, targetField));
        return <tr key={targetField.id}>
          <td><select aria-label={localizeMessage("{0}映射来源", [localize(targetField.name)])} value={entry?.source.id ?? ''} disabled={!ready || busy || !allowed} onChange={event => {
            const sourceField = sources.find(field => field.id === event.target.value);
            setConfig(current => ({ ...current, customFields: [...(current.customFields ?? []).filter(mapping => mapping.target.id !== targetField.id), ...(sourceField ? [{ source: structuredClone(sourceField), target: structuredClone(targetField), readonly: entry?.readonly ?? false }] : [])] })); setNotice('');
          }}><option value="">{localize("不映射")}</option>{localize(entry && !sources.some(field => field.id === entry.source.id) && <option value={entry.source.id} disabled>{localize(entry.source.name)}{localize("（已删除或不兼容）")}</option>)}{localize(sources.map(field => <option key={field.id} value={field.id}>{localize(field.name)}</option>))}</select></td>
          <td><ArrowRight size={15} aria-hidden="true" /></td><td>{localize(targetField.name)}</td>
          <td><div className="sr-mapping-readonly"><Switch aria-label={localizeMessage("{0}转换后只读", [localize(targetField.name)])} checked={entry?.readonly ?? false} disabled={!ready || busy || !allowed || !entry} onCheckedChange={checked => {
            setConfig(current => ({ ...current, customFields: current.customFields?.map(mapping => mapping.target.id === targetField.id ? { ...mapping, readonly: checked } : mapping) })); setNotice('');
          }} /><span>{localize(entry ? entry.readonly ? '只读' : '可编辑' : '未映射')}</span></div></td>
        </tr>;
      }))}
      </tbody></table></div>
    </section>))}</div>
  </div>;
}
