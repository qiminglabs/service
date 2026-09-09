import { Eye } from 'lucide-react';

export function CustomerVisibleBadge({ id }: { id?: string }) {
  return (
    <span id={id} className="sr-customer-visible-badge">
      <Eye size={14} aria-hidden="true" />
      客户可见
    </span>
  );
}
