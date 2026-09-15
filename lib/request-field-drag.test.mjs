import test from 'node:test';
import assert from 'node:assert/strict';
import { startRequestFieldDrag } from './request-field-drag.ts';

function fixture() {
  class Surface extends EventTarget {
    listeners = new Set();
    addEventListener(type, fn, options) { this.listeners.add(fn); super.addEventListener(type, fn, options); }
    removeEventListener(type, fn, options) { this.listeners.delete(fn); super.removeEventListener(type, fn, typeof options === 'boolean' ? { capture: options } : options); }
  }
  const win = new Surface();
  const doc = new Surface();
  const source = new Surface();
  let captured = false;
  const frames = new Set();
  win.requestAnimationFrame = fn => { frames.add(fn); return fn; };
  win.cancelAnimationFrame = fn => frames.delete(fn);
  source.setPointerCapture = () => { captured = true; };
  source.hasPointerCapture = () => captured;
  source.releasePointerCapture = () => { captured = false; };
  doc.defaultView = win;
  const target = { dataset: { fieldId: 'edition' } };
  const canvas = {};
  doc.elementFromPoint = () => ({ closest: selector => selector === '.rf-canvas' ? canvas : target });
  const root = { ownerDocument: doc, dataset: {}, contains: node => node === canvas, querySelector: () => null };
  const drops = [];
  let ends = 0;
  const cancel = startRequestFieldDrag({
    source, root, id: 'method', order: ['method', 'edition'], pointerId: 1, startX: 0, startY: 0,
    onDrag() {}, onEnd() { ends++; },
    onDrop(...args) { clean(); drops.push(args); },
  });
  function dispatch(type, props = {}, surface = win) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, clientX: 20, clientY: 20, buttons: 1, ...props });
    surface.dispatchEvent(event);
  }
  function clean() {
    assert.equal(captured, false);
    assert.equal(frames.size, 0);
    assert.equal(win.listeners.size + doc.listeners.size + source.listeners.size, 0);
    assert.deepEqual(root.dataset, {});
    assert.equal(target.dataset.dropEdge, undefined);
    assert.equal(ends, 1);
  }
  return { dispatch, clean, cancel, drops, doc, source, root };
}

test('松手先释放捕获和监听再修改顺序，后续事件不重复提交', () => {
  const f = fixture();
  f.dispatch('pointermove');
  assert.equal(f.root.dataset.fieldDragging, 'true');
  f.dispatch('pointerup');
  f.clean();
  f.dispatch('pointerup');
  assert.deepEqual(f.drops, [['method', 'edition']]);
});

for (const cause of ['pointercancel', 'blur', 'Escape', 'hidden', 'lostpointercapture', 'unmount', 'missed-release']) {
  test(`${cause} 清理所有交互状态且不修改表单`, () => {
    const f = fixture();
    f.dispatch('pointermove');
    if (cause === 'Escape') f.dispatch('keydown', { key: 'Escape' });
    else if (cause === 'hidden') { f.doc.hidden = true; f.dispatch('visibilitychange', {}, f.doc); }
    else if (cause === 'lostpointercapture') f.dispatch(cause, {}, f.source);
    else if (cause === 'unmount') f.cancel();
    else if (cause === 'missed-release') f.dispatch('pointermove', { buttons: 0 });
    else f.dispatch(cause);
    f.cancel();
    f.clean();
    f.dispatch('pointerup');
    assert.deepEqual(f.drops, []);
  });
}

test('点击及其他指针不会改变顺序或误结束当前拖动', () => {
  const f = fixture();
  f.dispatch('pointermove', { clientX: 1, clientY: 1 });
  f.dispatch('pointerup', { pointerId: 2 });
  f.dispatch('pointercancel', { pointerId: 2 });
  f.dispatch('pointerup');
  f.clean();
  assert.deepEqual(f.drops, []);
});
