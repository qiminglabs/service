'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { contactDisplay } from '@/lib/service-requests';
import type { ContactRef } from '@/lib/service-requests';

function ContactSummary({ contact }: { contact: ContactRef }) {
  const details = contactDisplay(contact);
  return (
    <span
      className="sr-contact-summary"
      title={`${details.name}${details.inactive ? '（已停用）' : ''} · 手机号：${details.phone} · 邮箱：${details.email}`}
    >
      <span className="sr-contact-name">
        {details.name}
        {details.inactive && (
          <span className="sr-contact-inactive">（已停用）</span>
        )}
      </span>
      <span className="sr-contact-details">
        <span>
          <span className="sr-contact-separator" aria-hidden="true">
            ·
          </span>
          <span className="sr-only">手机号：</span>
          {details.phone}
        </span>
        <span>
          <span className="sr-contact-separator" aria-hidden="true">
            ·
          </span>
          <span className="sr-only">邮箱：</span>
          {details.email}
        </span>
      </span>
    </span>
  );
}

export function RequestContactField({
  id,
  contacts,
  value,
  onChange,
  disabled = false,
  readonly = false,
  placeholder = '请选择联系人',
  hint,
}: {
  id: string;
  contacts: ContactRef[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readonly?: boolean;
  placeholder?: string;
  hint?: string;
}) {
  const selected = contacts.find((contact) => contact.id === value);
  return (
    <div className="sr-contact-field">
      <label id={id + '-label'} htmlFor={readonly ? undefined : id}>
        客户联系人 <em>*</em>
      </label>
      {readonly ? (
        <div className="sr-contact-readonly" aria-labelledby={id + '-label'}>
          {selected ? (
            <ContactSummary contact={selected} />
          ) : (
            <span>{value ? '联系人已失效' : '未选择联系人'}</span>
          )}
        </div>
      ) : (
        <Select
          value={value || null}
          onValueChange={(next) => onChange(next ?? '')}
          required
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            className="sr-contact-trigger"
            aria-labelledby={id + '-label'}
            aria-describedby={hint ? id + '-hint' : undefined}
          >
            <SelectValue>
              {selected ? (
                <ContactSummary contact={selected} />
              ) : (
                <span className="sr-contact-placeholder">
                  {value ? '联系人已失效，请重新选择' : placeholder}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            className="sr-contact-options"
            align="start"
            alignItemWithTrigger={false}
          >
            {contacts.map((contact) => (
              <SelectItem
                key={contact.id}
                value={contact.id}
                disabled={contact.status !== '启用'}
                className="sr-contact-option"
              >
                <ContactSummary contact={contact} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {hint && (
        <p id={id + '-hint'} className="sr-help">
          {hint}
        </p>
      )}
    </div>
  );
}
