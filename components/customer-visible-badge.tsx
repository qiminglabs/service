
import { useI18n } from '@/lib/i18n/context';
import { Eye } from 'lucide-react';

export function CustomerVisibleBadge({ id }: { id?: string }) {
  const { localize } = useI18n();
  return (
    <span id={id} className="sr-customer-visible-badge">
      <Eye size={14} aria-hidden="true" />
      {localize("客户可见")}</span>
  );
}
