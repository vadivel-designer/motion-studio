import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { layerCorners } from '../shared/geometry';
import { activeLayers, hitTest } from '../shared/geometry';
import { samplePath } from '../shared/cursor';
import type { Pt } from '../shared/cursor';
import { renderFrame } from '../shared/render';
import type { CursorLayer } from '../shared/schema';
import { startDrag } from './drag';
import {
  getResources, importFiles, relinkAsset, select, setProps, toggleSelect, updateCursor, useEditor,
} from './store';

let _mctx: CanvasRenderingContext2D | null = null;
export function measureCtx(): CanvasRenderingContext2D {
  if (!_mctx) _mctx = document.createElement('canvas').getContext('2d')!;
  return _mctx;
}

const HANDLE = 9;

export function pickFile(accept: string, cb: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => input.files?.[0] && cb(input.files[0]);
  input.click();
}

export function Preview() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const selection = useEditor((s) => s.selection);
  const version = useEditor((s) => s.resourceVersion);
  const missing = useEditor((s) => s.missingAssets);
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const { width: PW, height: PH } = project.settings;

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.01, Math.min((box.w - 32) / PW, (box.h - 32) / PH));
  const dispW = Math.max(10, Math.floor(PW * fit)), dispH = Math.max(10, Math.floor(PH * fit));
  const k = dispW / PW; // screen px per project px

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(dispW * dpr), ch = Math.round(dispH * dpr);
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    renderFrame(project, time, c.getContext('2d')!, cw / PW, getResources() ?? undefined);
  }, [project, time, dispW, dispH, version, PW]);

  const active = useMemo(() => activeLayers(project, time, measureCtx()), [project, time, version]);
  const selected = active.filter((a) => selection.includes(a.layer.id));
  const single = selected.length === 1 ? selected[0] : null;

  const toProject = (ev: { clientX: number; clientY: number }): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * PW, y: ((ev.clientY - r.top) / r.height) * PH };
  };
  const S = (p: Pt) => ({ x: p.x * k, y: p.y * k });

  /* ----- select / move ----- */
  const onStageDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const pt = toProject(e);
    const hit = hitTest(project, time, measureCtx(), pt, 24 / k);
    if (!hit) {
      if (!e.shiftKey) select([]);
      return;
    }
    const id = hit.layer.id;
    if (e.shiftKey) { toggleSelect(id); return; }
    if (!selection.includes(id)) select([id]);
    const ids = selection.includes(id) ? selection : [id];
    const starts = ids.map((i) => active.find((a) => a.layer.id === i)).filter((a) => a && !a.layer.locked).map((a) => ({
      id: a!.layer.id, x: a!.resolved.x, y: a!.resolved.y, cursor: a!.resolved.type === 'cursor',
      pts: a!.resolved.type === 'cursor' ? a!.resolved.points.map((p) => ({ ...p })) : [],
    }));
    startDrag(e, {
      onMove: (dx, dy, ev) => {
        let mx = dx / k, my = dy / k;
        if (ev.shiftKey) { if (Math.abs(mx) > Math.abs(my)) my = 0; else mx = 0; }
        for (const s of starts) {
          if (s.cursor) {
            updateCursor(s.id, (l) => l.points.forEach((p, i) => { p.x = s.pts[i].x + mx; p.y = s.pts[i].y + my; }));
          } else {
            setProps([s.id], { x: Math.round((s.x + mx) * 100) / 100, y: Math.round((s.y + my) * 100) / 100 });
          }
        }
      },
    });
  };

  /* ----- scale / rotate handles ----- */
  const startScale = (e: RPointerEvent) => {
    if (!single) return;
    const pivot = { x: single.resolved.x, y: single.resolved.y };
    const p0 = toProject(e);
    const d0 = Math.max(1e-3, Math.hypot(p0.x - pivot.x, p0.y - pivot.y));
    const s0 = single.resolved.scale, id = single.layer.id;
    startDrag(e, {
      onMove: (_dx, _dy, ev) => {
        const p = toProject(ev);
        let s = (s0 * Math.hypot(p.x - pivot.x, p.y - pivot.y)) / d0;
        if (ev.shiftKey) s = Math.round(s / 0.05) * 0.05;
        setProps([id], { scale: Math.max(0.01, Math.round(s * 1000) / 1000) });
      },
    });
  };
  const startRotate = (e: RPointerEvent) => {
    if (!single) return;
    const pivot = { x: single.resolved.x, y: single.resolved.y };
    const p0 = toProject(e);
    const a0 = Math.atan2(p0.y - pivot.y, p0.x - pivot.x);
    const r0 = single.resolved.rotation, id = single.layer.id;
    startDrag(e, {
      onMove: (_dx, _dy, ev) => {
        const p = toProject(ev);
        let r = r0 + ((Math.atan2(p.y - pivot.y, p.x - pivot.x) - a0) * 180) / Math.PI;
        if (ev.shiftKey) r = Math.round(r / 15) * 15;
        setProps([id], { rotation: Math.round(r * 10) / 10 });
      },
    });
  };

  /* ----- cursor path points ----- */
  const cursorLayer = single && single.resolved.type === 'cursor' ? (single.layer as CursorLayer) : null;
  const startPoint = (e: RPointerEvent, pid: string) => {
    if (!cursorLayer) return;
    const orig = cursorLayer.points.find((p) => p.id === pid)!;
    const id = cursorLayer.id, ox = orig.x, oy = orig.y;
    startDrag(e, {
      onMove: (dx, dy, ev) => {
        let mx = dx / k, my = dy / k;
        if (ev.shiftKey) { if (Math.abs(mx) > Math.abs(my)) my = 0; else mx = 0; }
        updateCursor(id, (l) => { const p = l.points.find((q) => q.id === pid); if (p) { p.x = Math.round(ox + mx); p.y = Math.round(oy + my); } });
      },
    });
  };

  const empty = project.scenes.every((s) => s.layers.length === 0);
  const corners = single && single.resolved.type !== 'cursor' ? layerCorners(single.resolved, single.size).map(S) : null;
  let rotHandle: Pt | null = null;
  if (corners) {
    const mid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const cen = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 };
    const len = Math.max(1e-3, Math.hypot(mid.x - cen.x, mid.y - cen.y));
    rotHandle = { x: mid.x + ((mid.x - cen.x) / len) * 28, y: mid.y + ((mid.y - cen.y) / len) * 28 };
  }
  const locked = single?.layer.locked;

  return (
    <div className="preview" ref={wrap}>
      <div
        className="stage"
        ref={stage}
        data-testid="stage"
        style={{ width: dispW, height: dispH }}
        onPointerDown={onStageDown}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = [...e.dataTransfer.files];
          if (files.length) void importFiles(files, toProject(e));
        }}
      >
        <canvas ref={canvas} data-testid="preview-canvas" style={{ width: dispW, height: dispH }} />
        {empty && <div className="empty-hint">Empty project — add text or a shape from the left panel, or drop an image here.</div>}
        <svg className="overlay" width={dispW} height={dispH}>
          {selected.map((a) => {
            if (a.resolved.type === 'cursor') return null;
            const c = layerCorners(a.resolved, a.size).map(S);
            return <polygon key={a.layer.id} className={`sel ${a.layer.locked ? 'locked' : ''}`} points={c.map((p) => `${p.x},${p.y}`).join(' ')} />;
          })}
          {corners && !locked && single && (
            <g>
              <line className="sel" x1={(corners[0].x + corners[1].x) / 2} y1={(corners[0].y + corners[1].y) / 2} x2={rotHandle!.x} y2={rotHandle!.y} />
              {corners.map((c, i) => (
                <rect key={i} className="handle" data-testid={`scale-handle-${i}`} x={c.x - HANDLE / 2} y={c.y - HANDLE / 2} width={HANDLE} height={HANDLE}
                  onPointerDown={startScale}><title>Drag to scale (Shift snaps to 5% steps)</title></rect>
              ))}
              <circle className="handle round" data-testid="rotate-handle" cx={rotHandle!.x} cy={rotHandle!.y} r={HANDLE / 2 + 1} onPointerDown={startRotate}>
                <title>Drag to rotate (Shift snaps to 15°)</title>
              </circle>
              <g className="pivot">
                <line x1={S({ x: single.resolved.x, y: 0 }).x - 6} x2={S({ x: single.resolved.x, y: 0 }).x + 6} y1={S({ x: 0, y: single.resolved.y }).y} y2={S({ x: 0, y: single.resolved.y }).y} />
                <line y1={S({ x: 0, y: single.resolved.y }).y - 6} y2={S({ x: 0, y: single.resolved.y }).y + 6} x1={S({ x: single.resolved.x, y: 0 }).x} x2={S({ x: single.resolved.x, y: 0 }).x} />
              </g>
            </g>
          )}
          {cursorLayer && (
            <g>
              <polyline className="path" fill="none" points={samplePath(cursorLayer.points, cursorLayer.smoothing).map((p) => `${p.x * k},${p.y * k}`).join(' ')} />
              {[...cursorLayer.points].sort((a, b) => a.time - b.time).map((p, i) => (
                <g key={p.id} className="cpoint" onPointerDown={(e) => !locked && startPoint(e, p.id)} data-testid={`cursor-point-${i}`}>
                  <circle cx={p.x * k} cy={p.y * k} r={9} />
                  <text x={p.x * k} y={p.y * k + 4} textAnchor="middle">{i + 1}</text>
                  <title>Path point {i + 1} — drag to move (Shift constrains to an axis)</title>
                </g>
              ))}
            </g>
          )}
        </svg>
        {active.flatMap((a) => (a.resolved.type === 'image' && missing.includes(a.resolved.assetId) ? [{ a, assetId: a.resolved.assetId }] : [])).map(({ a, assetId }) => {
          const c = S({ x: a.resolved.x, y: a.resolved.y });
          const asset = project.assets.find((x) => x.id === assetId);
          return (
            <button
              key={a.layer.id}
              className="relink"
              data-testid="relink-btn"
              style={{ left: c.x, top: c.y }}
              title={`The file "${asset?.originalName ?? ''}" is missing. Pick a replacement file.`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => asset && pickFile('.png,.jpg,.jpeg,.webp,.svg', (f) => void relinkAsset(asset.id, f))}
            >
              Relink…
            </button>
          );
        })}
      </div>
    </div>
  );
}
