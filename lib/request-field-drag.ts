// Keep the gesture outside React: moving the pointer must not rerender the form.
// Release capture and listeners before committing a new field order.
export function startRequestFieldDrag({
  source, root, id, order, pointerId, startX, startY, onDrop, onDrag, onEnd,
}: {
  source: HTMLElement;
  root: HTMLElement;
  id: string;
  order: string[];
  pointerId: number;
  startX: number;
  startY: number;
  onDrop: (id: string, target?: string) => void;
  onDrag: () => void;
  onEnd: () => void;
}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  let active = false;
  let finished = false;
  let target: HTMLElement | null = null;
  let inCanvas = false;
  let x = startX;
  let y = startY;
  let frame = 0;

  function locate() {
    const hit = doc.elementFromPoint(x, y);
    const canvas = hit?.closest('.rf-canvas');
    inCanvas = !!canvas && root.contains(canvas);
    const next = inCanvas ? hit?.closest<HTMLElement>('[data-field-id]') ?? null : null;
    if (next === target) return;
    if (target) delete target.dataset.dropEdge;
    target = next;
    if (target && target.dataset.fieldId !== id) {
      const index = order.indexOf(id);
      target.dataset.dropEdge = index >= 0 && index < order.indexOf(target.dataset.fieldId!) ? 'after' : 'before';
    }
  }

  function scroll() {
    if (finished) return;
    const center = root.querySelector<HTMLElement>('.rf-center');
    if (center) {
      const rect = center.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const delta = y < rect.top + 40 ? -10 : y > rect.bottom - 40 ? 10 : 0;
        if (delta) {
          center.scrollTop += delta;
          locate();
        }
      }
    }
    frame = win.requestAnimationFrame(scroll);
  }

  function cleanup() {
    if (finished) return;
    finished = true;
    win.cancelAnimationFrame(frame);
    win.removeEventListener('pointermove', move, true);
    win.removeEventListener('pointerup', up, true);
    win.removeEventListener('pointercancel', cancelPointer, true);
    win.removeEventListener('blur', cancel);
    win.removeEventListener('keydown', key, true);
    doc.removeEventListener('visibilitychange', visibility);
    source.removeEventListener('lostpointercapture', cancel);
    if (target) delete target.dataset.dropEdge;
    delete root.dataset.fieldDragging;
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
    onEnd();
  }
  function cancel() { cleanup(); }
  function cancelPointer(event: PointerEvent) {
    if (event.pointerId === pointerId) cleanup();
  }
  function visibility() { if (doc.hidden) cleanup(); }
  function key(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    // The first Escape cancels the gesture; the next can close the form.
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  }
  function move(event: PointerEvent) {
    if (finished || event.pointerId !== pointerId) return;
    if (!(event.buttons & 1)) { cleanup(); return; }
    x = event.clientX;
    y = event.clientY;
    if (!active && Math.hypot(x - startX, y - startY) < 5) return;
    if (!active) {
      active = true;
      root.dataset.fieldDragging = 'true';
      onDrag();
      frame = win.requestAnimationFrame(scroll);
    }
    event.preventDefault();
    locate();
  }
  function up(event: PointerEvent) {
    if (finished || event.pointerId !== pointerId) return;
    x = event.clientX;
    y = event.clientY;
    if (active) locate();
    const targetId = target?.dataset.fieldId;
    const commit = active && inCanvas && targetId !== id;
    cleanup();
    if (commit) onDrop(id, targetId);
  }

  source.setPointerCapture(pointerId);
  win.addEventListener('pointermove', move, { capture: true, passive: false });
  win.addEventListener('pointerup', up, true);
  win.addEventListener('pointercancel', cancelPointer, true);
  win.addEventListener('blur', cancel);
  win.addEventListener('keydown', key, true);
  doc.addEventListener('visibilitychange', visibility);
  source.addEventListener('lostpointercapture', cancel);
  return cleanup;
}
