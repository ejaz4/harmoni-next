"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// Drag-to-reorder for a list, by a handle on each row: the row follows the
// pointer, the others slide out of its way, and the list scrolls when you
// drag near its edge. Arrow keys on a handle move its row one place.
// Each handle gets `{...handle}` and `data-reorder={its row's index}`.

const EDGE_PX = 64;
const SCROLL_PX = 12; // per frame, at the very edge

interface Drag {
  from: number;
  over: number;
  dy: number;
  key: string;
  pointerId: number;
  startY: number;
  startScroll: number;
  lastY: number;
  mids: number[]; // each row's centre, from the list's top, when the drag began
  step: number; // how far rows move to make room
}

export function useReorder({
  keys,
  onMove,
  list,
  scroller,
}: {
  keys: string[]; // one per row, stable across moves
  onMove: (from: number, to: number) => void;
  list: () => HTMLElement | null; // whose children are the rows
  scroller: () => HTMLElement | null;
}) {
  const [drag, setDrag] = useState<Drag>();
  const live = useRef<Drag | undefined>(undefined);
  const frame = useRef(0);

  const update = (next: Drag | undefined) => {
    live.current = next;
    setDrag(next);
  };

  // Where the row is now, and the place it would drop into.
  const follow = (d: Drag, clientY: number): Drag => {
    const dy = clientY - d.startY + ((scroller()?.scrollTop ?? 0) - d.startScroll);
    const centre = d.mids[d.from] + dy;
    let over = d.from;
    d.mids.forEach((mid, j) => {
      if (j < d.from && centre < mid) over = Math.min(over, j);
      if (j > d.from && centre > mid) over = Math.max(over, j);
    });
    return { ...d, dy, over, lastY: clientY };
  };

  // Near the scroller's edges, keep scrolling while the pointer is held there.
  const edgeScroll = () => {
    const d = live.current;
    const el = scroller();
    if (!d || !el) return;
    const box = el.getBoundingClientRect();
    const into = d.lastY < box.top + EDGE_PX ? d.lastY - (box.top + EDGE_PX) : d.lastY > box.bottom - EDGE_PX ? d.lastY - (box.bottom - EDGE_PX) : 0;
    if (into) {
      el.scrollTop += Math.max(-1, Math.min(1, into / EDGE_PX)) * SCROLL_PX;
      update(follow(d, d.lastY));
    }
    frame.current = requestAnimationFrame(edgeScroll);
  };

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const finish = (commit: boolean) => {
    cancelAnimationFrame(frame.current);
    const d = live.current;
    update(undefined);
    // A row that moved under us (a song ended, the queue changed) isn't dropped anywhere.
    if (commit && d && d.over !== d.from && keys[d.from] === d.key) onMove(d.from, d.over);
  };

  const indexOf = (e: React.SyntheticEvent<HTMLElement>) => Number(e.currentTarget.dataset.reorder);
  const handle = {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      const el = list();
      if (e.button !== 0 || !el) return;
      const i = indexOf(e);
      e.stopPropagation(); // not a pull on the sheet
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const top = el.getBoundingClientRect().top;
      const rows = [...el.children].map((row) => row.getBoundingClientRect());
      const gap = rows.length > 1 ? rows[1].top - rows[0].bottom : 0;
      navigator.vibrate?.(8);
      update({
        from: i,
        over: i,
        dy: 0,
        key: keys[i],
        pointerId: e.pointerId,
        startY: e.clientY,
        startScroll: scroller()?.scrollTop ?? 0,
        lastY: e.clientY,
        mids: rows.map((r) => r.top - top + r.height / 2),
        step: rows[i].height + gap,
      });
      frame.current = requestAnimationFrame(edgeScroll);
    },
    onPointerMove(e: React.PointerEvent) {
      const d = live.current;
      if (d && d.pointerId === e.pointerId) update(follow(d, e.clientY));
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onClick: (e: React.MouseEvent) => e.stopPropagation(), // the row's own click plays it
    onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
      const i = indexOf(e);
      const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : -1;
      if (to < 0 || to >= keys.length) return;
      e.preventDefault();
      onMove(i, to);
    },
  };

  const row = (i: number): { style?: CSSProperties; dragging: boolean } => {
    if (!drag) return { dragging: false };
    if (i === drag.from) return { dragging: true, style: { transform: `translateY(${drag.dy}px)`, transition: "none", zIndex: 2 } };
    const shift = drag.from < drag.over && i > drag.from && i <= drag.over ? -drag.step : drag.over < drag.from && i >= drag.over && i < drag.from ? drag.step : 0;
    return { dragging: false, style: { transform: shift ? `translateY(${shift}px)` : undefined } };
  };

  return { handle, row, active: !!drag };
}
