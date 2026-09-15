'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export function RuleDeleteDialog({ open, requirement, description, busy, error, onCancel, onConfirm }: {
  open: boolean;
  requirement: string;
  description: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onCancel(); }}>
    <DialogContent className="submission-rule-dialog" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>删除规则</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <div className="submission-rule-form">
        <div className="submission-rule-form-body">
          <p className="whitespace-pre-wrap break-words">{requirement}</p>
          {error && <p className="sr-error" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? '正在删除…' : '删除规则'}</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>;
}
