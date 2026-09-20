'use client';

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = new Set(dailyReportEmails(value));
  const candidates = recipients.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const unavailable = recipients.filter(person => person.group === defaultGroup && person.issue);
  return <div className="daily-report-field daily-recipient-field">
    <div className="daily-recipient-label"><label htmlFor={id}>{label}{required && <em> *</em>}</label>
      <Popover open={open && !disabled} onOpenChange={next => { setOpen(next); if (next) setQuery(''); }}>
        <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" />} disabled={disabled}><UsersRound size={14} />选择协作人</PopoverTrigger>
        <PopoverContent className="daily-recipient-popover" align="end" aria-label={`选择${label}协作人`}>
          <Input aria-label={`搜索${label}协作人`} placeholder="搜索姓名或邮箱" value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} />
          <div className="daily-recipient-options">
            {groups.map(group => {
              const people = candidates.filter(person => person.group === group.id);
              if (!people.length) return null;
              return <section key={group.id} aria-label={group.name}><h4>{group.name}</h4>{people.map(person => <label key={person.key} className="daily-recipient-option" data-disabled={!!person.issue || undefined}>
                <Checkbox disabled={disabled || !!person.issue} checked={!person.issue && selected.has(person.email)} onCheckedChange={checked => onChange(toggleDailyReportRecipient(value, person, checked))} aria-label={`${person.name} ${person.email || person.issue}`} />
                <span><strong>{person.name}</strong><small>{person.email || person.issue}{person.issue && person.email ? ` · ${person.issue}` : ''}</small></span>
              </label>)}</section>;
            })}
            {!candidates.length && <p className="daily-recipient-none">{recipients.length ? '未找到匹配的协作人' : '暂无项目协作人'}</p>}
          </div>
          <div className="daily-recipient-footer"><span>已填写 {selected.size} 个邮箱</span><Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>完成</Button></div>
        </PopoverContent>
      </Popover>
    </div>
    <Textarea id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required={required} rows={2} maxLength={13000} placeholder="输入邮箱，多个地址以分号分隔" aria-describedby={unavailable.length ? `${id}-unavailable` : undefined} />
    {!!unavailable.length && <small id={`${id}-unavailable`} className="daily-recipient-warning">未带入：{unavailable.map(person => `${person.name}（${person.issue}）`).join('、')}</small>}
  </div>;
}
