
import { useI18n } from '@/lib/i18n/context';
export function MentionOptionLabel({ name, companyName, email }: { name: string; companyName?: string; email?: string }) {
  const { localize } = useI18n();
  return <><strong>{localize(name)}</strong><small>{localize(companyName?.trim() || '未填写公司名称')}、{localize(email?.trim() || '未填写邮箱')}</small></>;
}
