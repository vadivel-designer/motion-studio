import type { PointerEvent as RPointerEvent } from 'react';
import { beginTx, endTx } from './store';

export interface DragHandlers {
  onMove: (dx: number, dy: number, ev: PointerEvent) => void;
  /** moved=false means it was a plain click (< 3px of travel) */
  onEnd?: (moved: boolean) => void;
  /** group all edits made during the drag into one undo step (default true) */
  tx?: boolean;
}

/** Window-level pointer drag. One drag = one history step. */
export function startDrag(e: RPointerEvent | PointerEvent, h: DragHandlers) {
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  let moved = false;
  const useTx = h.tx !== false;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved) {
      if (Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (useTx) beginTx();
    }
    h.onMove(dx, dy, ev);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (useTx) endTx();
    h.onEnd?.(moved);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
