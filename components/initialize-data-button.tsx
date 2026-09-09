'use client';

import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

export function InitializeDataButton({ disabled, onInitialize }: { disabled: boolean; onInitialize: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function confirm() {
    if (lock.current || disabled) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await onInitialize();
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '初始化失败，原数据已保留，请重试。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <>
    <Button className="initialize-data-button" variant="outline" disabled={disabled || busy} onClick={() => { setError(''); setOpen(true); }}>
      <RotateCcw aria-hidden="true" />初始化数据
    </Button>
    <AlertDialog open={open} onOpenChange={value => { if (!lock.current) setOpen(value); }}>
      <AlertDialogContent className="initialize-data-dialog" aria-busy={busy}>
        <AlertDialogHeader>
          <AlertDialogTitle>确认初始化全部数据？</AlertDialogTitle>
          <AlertDialogDescription>
            初始化将覆盖当前所有本地修改，无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="sr-error" role="alert">{error}</p>}
        <AlertDialogFooter>
          {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- Focus the safe action inside this destructive confirmation. */}
          <AlertDialogCancel disabled={busy} autoFocus>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={busy || disabled} onClick={() => void confirm()}>
            {busy ? '正在初始化…' : '确认初始化'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
