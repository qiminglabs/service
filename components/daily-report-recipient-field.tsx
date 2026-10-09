'use client';
import { useI18n } from '@/lib/i18n/context';


import { useState } from 'react';
import { UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dailyReportEmails } from '@/lib/service-project-daily-reports';
import { toggleDailyReportRecipient, type DailyReportRecipient } from '@/lib/project-daily-report-recipients';

const groups = [{ id: 'customer', name: '客户协作人' }, { id: 'internal', name: '内部协作人' }, { id: 'partner', name: '合作伙伴协作人' }] as const;
export function DailyReportRecipientField({ id, label, value, onChange, recipients, defaultGroup, required = false, disabled = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  recipients: DailyReportRecipient[]; defaultGroup: 'customer' | 'internal'; required?: boolean; disabled?: boolean;
}) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set(dailyReportEmails(value));
  const candidates = recipients.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const unavailable = recipients.filter(person => person.group === defaultGroup && person.issue);
  return <div className="daily-report-field daily-recipient-field">
    <div className="daily-recipient-label"><label htmlFor={id}>{localize(label)}{localize(required && <em> *</em>)}</label>
      <Popover open={open && !disabled} onOpenChange={next => { setOpen(next); if (next) setQuery(''); }}>
        <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />} disabled={disabled}><UsersRound size={14} />{localize("选择协作人")}</PopoverTrigger>
        <PopoverContent className="daily-recipient-popover" align="end" aria-label={localizeMessage("选择{0}协作人", [localize(label)])}>
          <Input aria-label={localizeMessage("搜索{0}协作人", [localize(label)])} placeholder={localize("搜索姓名或邮箱")} value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} />
          <div className="daily-recipient-options">
            {localize(groups.map(group => {
              const people = candidates.filter(person => person.group === group.id);
              if (!people.length) return null;
              return <section key={group.id} aria-label={localize(group.name)}><h4>{localize(group.name)}</h4>{localize(people.map(person => <label key={person.key} className="daily-recipient-option" data-disabled={!!person.issue || undefined}>
                <Checkbox disabled={disabled || !!person.issue} checked={!person.issue && selected.has(person.email)} onCheckedChange={checked => onChange(toggleDailyReportRecipient(value, person, checked))} aria-label={localizeMessage("{0} {1}", [localize(person.name), localize(person.email || person.issue)])} />
                <span><strong>{localize(person.name)}</strong><small>{localize(person.email || person.issue)}{localize(person.issue && person.email ? localizeMessage(" · {0}", [String(localize(person.issue))]) : '')}</small></span>
              </label>))}</section>;
            }))}
            {localize(!candidates.length && <p className="daily-recipient-none">{localize(recipients.length ? '未找到匹配的协作人' : '暂无项目协作人')}</p>)}
          </div>
          <div className="daily-recipient-footer"><span>{localize("已填写")}{localize(selected.size)} {localize(" 个邮箱")}</span><Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>{localize("完成")}</Button></div>
        </PopoverContent>
      </Popover>
    </div>
    <Textarea id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} rows={2} maxLength={13000} placeholder={localize("输入邮箱，多个地址以分号分隔")} aria-describedby={unavailable.length ? `${id}-unavailable` : undefined} />
    {localize(!!unavailable.length && <small id={`${id}-unavailable`} className="daily-recipient-warning">{localize("未带入：")}{localize(localizeList(unavailable.map(person => localizeMessage('{0}（{1}）', [person.name, localize(person.issue)])), '、'))}</small>)}
  </div>;
}
