import { useEffect, useRef } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { animatableProps, clamp, PROP_META, snapToFrame } from '../shared/animation';
import type { Keyframe, Layer, Scene } from '../shared/schema';
import { startDrag } from './drag';
import {
  activeScene, dragKeyframes, select, setActiveScene, setLayerTiming, setScenesTiming, setTime, toggleSelect, useEditor,
} from './store';

const LABEL_W = 190;
const MIN_SNAP_PX = 8;

function tickStep(zoom: number) {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s * zoom >= 70) return s;
  return 300;
}

interface Cluster { time: number; props: string[] }
function clusters(layer: Layer): Cluster[] {
  const map = new Map<string, Cluster>();
  for (const [prop, list] of Object.entries(layer.keyframes)) {
    for (const k of list) {
      const key = k.time.toFixed(4);
      const c = map.get(key) ?? { time: k.time, props: [] };
      c.props.push(prop);
      map.set(key, c);
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const playing = useEditor((s) => s.playing);
  const scene = useEditor((s) => activeScene(s));
  const inner = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fps = project.settings.fps;
  const dur = project.settings.durationSec;
  const maxEnd = Math.max(dur, ...project.scenes.map((s) => s.start + s.duration));
  const xOf = (t: number) => LABEL_W + t * zoom;
  const innerW = xOf(maxEnd) + 80;
  const timeAt = (clientX: number) => (clientX - inner.current!.getBoundingClientRect().left - LABEL_W) / zoom;
  const setZoom = (z: number) => useEditor.setState({ zoom: clamp(z, 10, 600) });

  useEffect(() => {
    if (!playing || !scroller.current) return;
    const el = scroller.current, x = xOf(time);
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + LABEL_W) el.scrollLeft = Math.max(0, x - LABEL_W - 40);
  }, [time, playing]);

  const scrub = (e: RPointerEvent) => {
    setTime(timeAt(e.clientX));
    startDrag(e, { tx: false, onMove: (_dx, _dy, ev) => setTime(timeAt(ev.clientX)) });
  };

  /* ----- snapping ----- */
  const snapCandidates = (skipSceneId?: string) => {
    const c = [0, dur, time];
    for (const s of project.scenes) if (s.id !== skipSceneId) c.push(s.start, s.start + s.duration);
    return c;
  };
  const snapEdge = (t: number, cands: number[]) => {
    let best = snapToFrame(t, fps), bd = MIN_SNAP_PX / zoom;
    for (const c of cands) if (Math.abs(c - t) < bd) { bd = Math.abs(c - t); best = c; }
    return best;
  };

  /* ----- scene drags ----- */
  const dragScene = (e: RPointerEvent, s: Scene, mode: 'move' | 'left' | 'right') => {
    const min = 1 / fps;
    const end0 = s.start + s.duration;
    const prev = project.scenes.find((o) => o.id !== s.id && Math.abs(o.start + o.duration - s.start) < 1e-3);
    const next = project.scenes.find((o) => o.id !== s.id && Math.abs(o.start - end0) < 1e-3);
    const cands = snapCandidates(s.id);
    const wasActive = s.id === scene?.id;
    startDrag(e, {
      onMove: (dx) => {
        const dt = dx / zoom;
        if (mode === 'move') {
          let ns = Math.max(0, s.start + dt);
          const a = snapEdge(ns, cands), b = snapEdge(ns + s.duration, cands) - s.duration;
          ns = Math.abs(a - ns) <= Math.abs(b - ns) ? a : b;
          setScenesTiming([{ id: s.id, start: Math.max(0, ns), duration: s.duration }]);
        } else if (mode === 'right') {
          const hi = next ? next.start + next.duration - min : Infinity;
          const ne = clamp(snapEdge(end0 + dt, cands.filter((c) => c !== end0)), s.start + min, hi);
          const ups = [{ id: s.id, start: s.start, duration: ne - s.start }];
          if (next) ups.push({ id: next.id, start: ne, duration: next.start + next.duration - ne });
          setScenesTiming(ups);
        } else {
          const lo = prev ? prev.start + min : 0;
          const nb = clamp(snapEdge(s.start + dt, cands.filter((c) => c !== s.start)), lo, end0 - min);
          const ups = [{ id: s.id, start: nb, duration: end0 - nb }];
          if (prev) ups.push({ id: prev.id, start: prev.start, duration: nb - prev.start });
          setScenesTiming(ups);
        }
      },
      onEnd: (moved) => { if (!moved && !wasActive) setActiveScene(s.id); else if (!moved) { select([]); } },
    });
    if (!wasActive) setActiveScene(s.id);
  };

  /* ----- layer drags ----- */
  const dragLayer = (e: RPointerEvent, sc: Scene, l: Layer, mode: 'move' | 'left' | 'right') => {
    if (e.shiftKey && mode === 'move') { toggleSelect(l.id); return; }
    if (!selection.includes(l.id)) select([l.id]);
    if (l.locked) return;
    const min = 1 / fps, end0 = l.start + l.duration;
    startDrag(e, {
      onMove: (dx) => {
        const dt = dx / zoom;
        const abs = (t: number) => snapEdge(sc.start + t, snapCandidates()) - sc.start;
        if (mode === 'move') {
          const ns = clamp(abs(l.start + dt), 0, Math.max(0, sc.duration - min));
          setLayerTiming(l.id, ns, l.duration);
        } else if (mode === 'left') {
          const ns = clamp(abs(l.start + dt), 0, end0 - min);
          setLayerTiming(l.id, ns, end0 - ns);
        } else {
          const ne = Math.max(l.start + min, abs(end0 + dt));
          setLayerTiming(l.id, l.start, ne - l.start);
        }
      },
    });
  };

  /* ----- keyframe drags ----- */
  const dragKf = (e: RPointerEvent, sc: Scene, l: Layer, c: Cluster) => {
    e.stopPropagation();
    if (!selection.includes(l.id)) select([l.id]);
    const snapshot: Layer['keyframes'] = JSON.parse(JSON.stringify(l.keyframes));
    const absT = sc.start + l.start + c.time;
    startDrag(e, {
      onMove: (dx) => { if (!l.locked) dragKeyframes(l.id, c.props, c.time, c.time + dx / zoom, snapshot); },
      onEnd: (moved) => { if (!moved) setTime(absT); },
    });
  };

  const step = tickStep(zoom);
  const ticks: number[] = [];
  for (let t = 0; t <= maxEnd + 1e-6; t += step) ticks.push(Number(t.toFixed(4)));
  const layers = scene ? [...scene.layers].reverse() : [];
  const sel1 = selection.length === 1 ? selection[0] : null;

  const Diamond = ({ sc, l, c, label }: { sc: Scene; l: Layer; c: Cluster; label: string }) => (
    <div
      className={`kf ${Math.abs(sc.start + l.start + c.time - time) < 0.5 / fps ? 'on' : ''}`}
      data-testid="kf-diamond"
      data-time={c.time.toFixed(3)}
      data-layer={l.id}
      style={{ left: c.time * zoom - 6 }}
      title={`Keyframe: ${label} at ${c.time.toFixed(2)}s. Click to jump here, drag to move in time.`}
      onPointerDown={(e) => dragKf(e, sc, l, c)}
    />
  );

  return (
    <div className="timeline" data-testid="timeline">
      <div className="tl-head">
        <span className="title">Timeline</span>
        <span className="spacer" />
        <button className="icon" title="Zoom out the timeline" aria-label="Zoom out" onClick={() => setZoom(zoom / 1.4)}>−</button>
        <input type="range" min={10} max={400} value={zoom} title="Timeline zoom (pixels per second)" onChange={(e) => setZoom(Number(e.target.value))} />
        <button className="icon" title="Zoom in the timeline" aria-label="Zoom in" onClick={() => setZoom(zoom * 1.4)}>+</button>
        <button
          className="small"
          title="Zoom so the whole project fits the width"
          onClick={() => setZoom(((scroller.current?.clientWidth ?? 800) - LABEL_W - 60) / maxEnd)}
        >Fit</button>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" ref={inner} style={{ width: innerW }}>
          <div className="tl-row ruler" style={{ height: 26 }}>
            <div className="tl-label">Time</div>
            <div className="tl-track ruler-track" data-testid="ruler" onPointerDown={scrub} title="Click or drag to scrub the playhead">
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: xOf(t) - LABEL_W }}>
                  <span>{t % 1 === 0 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : t.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="tl-after" style={{ left: xOf(dur), width: Math.max(0, innerW - xOf(dur)) }} title="Past the end of the project – not exported" />

          <div className="tl-row">
            <div className="tl-label strong">Scenes</div>
            <div className="tl-track">
              {project.scenes.map((s) => (
                <div
                  key={s.id}
                  className={`scene-block ${s.id === scene?.id ? 'active' : ''}`}
                  data-testid="scene-block"
                  style={{ left: xOf(s.start) - LABEL_W, width: s.duration * zoom }}
                  title={`${s.name}: drag to move, drag the edges to change the cut points`}
                  onPointerDown={(e) => dragScene(e, s, 'move')}
                >
                  <span className="edge l" data-testid="scene-edge-left" title="Drag to move this scene's start" onPointerDown={(e) => dragScene(e, s, 'left')} />
                  <span className="name">{s.name}</span>
                  <span className="edge r" data-testid="scene-edge-right" title="Drag to move this scene's end" onPointerDown={(e) => dragScene(e, s, 'right')} />
                </div>
              ))}
            </div>
          </div>

          {scene && layers.length === 0 && (
            <div className="tl-row"><div className="tl-label muted">No layers</div><div className="tl-track muted-note">Layers of “{scene.name}” appear here.</div></div>
          )}
          {scene && layers.map((l) => {
            const cl = clusters(l);
            const props = animatableProps(l.type).filter((p) => l.keyframes[p]?.length);
            return (
              <div key={l.id}>
                <div className={`tl-row layer ${selection.includes(l.id) ? 'selected' : ''}`} data-testid="timeline-layer-row" data-layer={l.id}>
                  <div className="tl-label" onClick={(e) => (e.shiftKey ? toggleSelect(l.id) : select([l.id]))} title={l.name}>
                    <span className={`dot ${l.type}`} />{l.name}
                  </div>
                  <div className="tl-track">
                    <div
                      className={`bar ${l.type} ${l.visible ? '' : 'hidden'} ${l.locked ? 'locked' : ''}`}
                      data-testid="layer-bar"
                      style={{ left: xOf(scene.start + l.start) - LABEL_W, width: Math.max(4, l.duration * zoom) }}
                      title={`${l.name}: drag to move in time, drag the ends to trim`}
                      onPointerDown={(e) => dragLayer(e, scene, l, 'move')}
                    >
                      <span className="edge l" title="Trim start" onPointerDown={(e) => dragLayer(e, scene, l, 'left')} />
                      {cl.map((c) => <Diamond key={c.time} sc={scene} l={l} c={c} label={c.props.map((p) => PROP_META[p]?.label ?? p).join(', ')} />)}
                      <span className="edge r" title="Trim end" onPointerDown={(e) => dragLayer(e, scene, l, 'right')} />
                    </div>
                  </div>
                </div>
                {sel1 === l.id && props.map((p) => (
                  <div className="tl-row sub" key={p}>
                    <div className="tl-label sub">{PROP_META[p]?.label ?? p}</div>
                    <div className="tl-track">
                      <div className="subbar" style={{ left: xOf(scene.start + l.start) - LABEL_W, width: l.duration * zoom }}>
                        {(l.keyframes[p] as Keyframe[]).map((k) => <Diamond key={k.time} sc={scene} l={l} c={{ time: k.time, props: [p] }} label={PROP_META[p]?.label ?? p} />)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="playhead" data-testid="playhead" style={{ left: xOf(time) }}><div className="head" /></div>
        </div>
      </div>
    </div>
  );
}
