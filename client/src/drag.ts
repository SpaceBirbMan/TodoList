import type { PointerEvent as ReactPointerEvent } from 'react';

export type Point = { x: number; y: number };
export type Gesture = 'click' | 'drag' | 'cancel';

export function trackPointer(opts: {
  event: ReactPointerEvent;
  holdMs: number;
  canDrag?: () => boolean;
  onRefuse?: () => void;
  onDragStart: () => void;
  onMove: (point: Point) => void;
  onEnd: (point: Point, gesture: Gesture) => void;
}) {
  const start = { x: opts.event.clientX, y: opts.event.clientY };
  const pointerId = opts.event.pointerId;
  const target = opts.event.currentTarget;
  if (target instanceof HTMLElement) {
    try { target.setPointerCapture(pointerId); } catch { /* pointer already released */ }
  }
  let dragged = false;
  let ready = opts.holdMs <= 0;
  let closed = false;
  const hold = window.setTimeout(() => { ready = true; }, opts.holdMs);

  const finish = (point: Point, gesture: Gesture) => {
    if (closed) return;
    closed = true;
    window.clearTimeout(hold);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    opts.onEnd(point, gesture);
  };

  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || closed) return;
    const point = { x: event.clientX, y: event.clientY };
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    if (!dragged && distance > 6) {
      if (!ready) {
        finish(point, 'cancel');
        return;
      }
      if (opts.canDrag && !opts.canDrag()) {
        opts.onRefuse?.();
        finish(point, 'cancel');
        return;
      }
      dragged = true;
      opts.onDragStart();
    }
    if (dragged) opts.onMove(point);
  };

  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    const distance = Math.hypot(point.x - start.x, point.y - start.y);
    finish(point, dragged ? 'drag' : distance > 6 ? 'cancel' : 'click');
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
