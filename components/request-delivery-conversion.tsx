'use client';
import { useI18n } from '@/lib/i18n/context';


import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export function RequestDeliveryConversion({ busy, onConfirm, onClose }: {
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { localize } = useI18n();
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sr-dialog" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>{localize("确定转为服务交付")}</DialogTitle>
        <DialogDescription>{localize("确定将此技术评估请求转为服务交付？转换后继续关联服务依据，已评估材料和核定结果保留。")}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>{localize("取消")}</Button>
        <Button disabled={busy} onClick={onConfirm}>{localize("确定转为服务交付")}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
