'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export function RequestDeliveryConversion({ busy, onConfirm, onClose }: {
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sr-dialog" showCloseButton={!busy}>
      <DialogHeader>
        <DialogTitle>确定转为服务交付</DialogTitle>
        <DialogDescription>确定将此售前评估请求转为服务交付？转换后继续关联服务依据，已评估材料和核定结果保留。</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
        <Button disabled={busy} onClick={onConfirm}>确定转为服务交付</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
