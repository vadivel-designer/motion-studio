import { useState } from 'react';
import { clamp, snapToFrame } from '../shared/animation';
import { uid } from '../shared/factory';
import { DEFAULT_PRESET } from '../shared/presets';
import type { Direction, PresetKind, PresetParams, StaggerOrder, StaggerParams } from '../shared/presets';
import type { CursorLayer } from '../shared/schema';
import { EasingEditor } from './EasingEditor';
import {
  addLayer, applyPresetTo, applyStaggerTo, findLayer, localTime, updateCursor, useEditor,
} from './store';
import { ColorField, NumberField, Row, Section } from './ui';

export function Phase2AddButtons() {
  return (
    <button className="small" title="Add a cursor layer: an animated mouse pointer that follows a path you can drag in the preview, with click ripples" data-testid="add-cursor" onClick={() => addLayer({ kind: 'cursor' })}>
      ↖ Cursor
    </button>
  );
}

function PresetsSection({ ids }: { ids: string[] }) {
  const [p, setP] = useState<PresetParams>(DEFAULT_PRESET);
  const patch = (o: Partial<PresetParams>) => setP((x) => ({ ...x, ...o }));
  return (
    <Section title="Animation presets" tip="One-click animations. They create normal keyframes that you can then edit.">
      <Row label="Effect" tip="What changes during the animation">
        <select data-testid="preset-kind" value={p.kind} title="Fade changes opacity, Slide moves the layer, Scale grows or shrinks it" onChange={(e) => patch({ kind: e.target.value as PresetKind })}>
          <option value="fade">Fade</option><option value="slide">Slide</option><option value="scale">Scale</option>
        </select>
      </Row>
      <Row label="When" tip="Animate the layer appearing (in) or disappearing (out)">
        <span className="seg">
          {(['in', 'out'] as const).map((ph) => (
            <button key={ph} type="button" data-testid={`preset-phase-${ph}`} className={p.phase === ph ? 'on' : ''} title={ph === 'in' ? 'Animate when the layer appears' : 'Animate just before the layer disappears'} onClick={() => patch({ phase: ph })}>
              {ph === 'in' ? 'In' : 'Out'}
            </button>
          ))}
        </span>
      </Row>
      {p.kind === 'slide' && (
        <>
          <Row label="Direction" tip={p.phase === 'in' ? 'Side the layer slides in from' : 'Side the layer slides out to'}>
            <select data-testid="preset-direction" value={p.direction} title="Slide direction" onChange={(e) => patch({ direction: e.target.value as Direction })}>
              <option value="left">{p.phase === 'in' ? 'From the left' : 'To the left'}</option>
              <option value="right">{p.phase === 'in' ? 'From the right' : 'To the right'}</option>
              <option value="up">{p.phase === 'in' ? 'From the top' : 'To the top'}</option>
              <option value="down">{p.phase === 'in' ? 'From the bottom' : 'To the bottom'}</option>
            </select>
          </Row>
          <Row label="Distance" tip="How far the layer travels, in project pixels">
            <NumberField testId="preset-distance" value={p.distance} step={20} min={0} decimals={0} onCommit={(v) => patch({ distance: v })} /><span className="unit">px</span>
          </Row>
        </>
      )}
      {p.kind === 'scale' && (
        <Row label="Scale from" tip="Scale at the hidden end of the animation (0% = from nothing)">
          <NumberField testId="preset-scalefrom" value={p.scaleFrom * 100} step={10} min={0} decimals={0} onCommit={(v) => patch({ scaleFrom: v / 100 })} /><span className="unit">%</span>
        </Row>
      )}
      <Row label="Delay" tip={p.phase === 'in' ? 'Wait this long after the layer appears' : 'Finish this long before the layer disappears'}>
        <NumberField testId="preset-delay" value={p.delay} step={0.1} min={0} onCommit={(v) => patch({ delay: v })} /><span className="unit">s</span>
      </Row>
      <Row label="Duration" tip="How long the animation takes">
        <NumberField testId="preset-duration" value={p.duration} step={0.1} min={0.05} onCommit={(v) => patch({ duration: v })} /><span className="unit">s</span>
      </Row>
      <EasingEditor easing={p.easing} onChange={(e) => patch({ easing: e })} />
      <button className="primary" data-testid="preset-apply" title="Create the keyframes. Applying the same effect again replaces the old ones. Undo reverts it." onClick={() => applyPresetTo(ids, p)}>
        Apply {p.kind} {p.phase}{ids.length > 1 ? ` to ${ids.length} layers` : ''}
      </button>
    </Section>
  );
}

function StaggerSection({ ids }: { ids: string[] }) {
  const [p, setP] = useState<StaggerParams>({ order: 'forward', interval: 0.2, seed: 1 });
  return (
    <Section title="Stagger" tip="Offsets the start times of the selected layers so they appear one after another.">
      <Row label="Order" tip="Which layer starts first">
        <select data-testid="stagger-order" value={p.order} title="Order in which the layers start" onChange={(e) => setP({ ...p, order: e.target.value as StaggerOrder })}>
          <option value="forward">Forward (bottom layer first)</option>
          <option value="reverse">Reverse (top layer first)</option>
          <option value="random">Random (seeded)</option>
        </select>
      </Row>
      <Row label="Interval" tip="Delay between one layer starting and the next (seconds)">
        <NumberField testId="stagger-interval" value={p.interval} step={0.05} min={0} onCommit={(v) => setP({ ...p, interval: v })} /><span className="unit">s</span>
      </Row>
      {p.order === 'random' && (
        <Row label="Seed" tip="The same seed always gives the same random order">
          <NumberField testId="stagger-seed" value={p.seed} step={1} decimals={0} onCommit={(v) => setP({ ...p, seed: Math.round(v) })} />
          <button className="small" title="Pick another random order" onClick={() => setP({ ...p, seed: Math.floor(Math.random() * 9999) })}>Shuffle</button>
        </Row>
      )}
      <button className="primary" data-testid="stagger-apply" title="Offset the layers' start times. Undo reverts it." onClick={() => applyStaggerTo(ids, p)}>
        Apply stagger to {ids.length} layers
      </button>
    </Section>
  );
}

function CursorSection({ layer }: { layer: CursorLayer }) {
  const project = useEditor((s) => s.project);
  const time = useEditor((s) => s.time);
  const found = findLayer(project, layer.id)!;
  const fps = project.settings.fps;
  const pts = [...layer.points].sort((a, b) => a.time - b.time);
  const clicks = [...layer.clicks].sort((a, b) => a.time - b.time);
  const id = layer.id;
  const tl = clamp(snapToFrame(localTime(project, found.scene, layer, time), fps), 0, layer.duration);
  return (
    <>
      <Section title="Cursor path" tip="The pointer travels through these points. Drag the numbered dots in the preview to move them.">
        <Row label="Smoothing" tip="0 = straight lines between points, 1 = smooth curved path">
          <NumberField testId="cursor-smoothing" value={layer.smoothing} step={0.1} min={0} max={1} onCommit={(v) => updateCursor(id, (l) => { l.smoothing = v; })} />
        </Row>
        <Row label="Cursor" tip="Cursor fill color"><ColorField value={layer.color} title="Cursor color" onChange={(v) => updateCursor(id, (l) => { l.color = v; })} /></Row>
        <Row label="Ripple" tip="Color of the click ripple"><ColorField value={layer.rippleColor} title="Click ripple color" onChange={(v) => updateCursor(id, (l) => { l.rippleColor = v; })} /></Row>
        <div className="ptlist" data-testid="cursor-points">
          <div className="pthead"><span>#</span><span>X</span><span>Y</span><span>Time</span><span /></div>
          {pts.map((p, i) => (
            <div className="ptrow" key={p.id} data-testid="cursor-point-row">
              <span>{i + 1}</span>
              <NumberField value={p.x} decimals={0} step={10} title="Point X (project pixels)" onCommit={(v) => updateCursor(id, (l) => { const q = l.points.find((z) => z.id === p.id); if (q) q.x = v; })} />
              <NumberField value={p.y} decimals={0} step={10} title="Point Y (project pixels)" onCommit={(v) => updateCursor(id, (l) => { const q = l.points.find((z) => z.id === p.id); if (q) q.y = v; })} />
              <NumberField value={p.time} decimals={2} step={0.1} min={0} title="Time the cursor reaches this point (seconds into the layer)" onCommit={(v) => updateCursor(id, (l) => { const q = l.points.find((z) => z.id === p.id); if (q) q.time = v; })} />
              <button className="icon" title="Remove this path point" aria-label="Remove point" disabled={pts.length <= 1} onClick={() => updateCursor(id, (l) => { l.points = l.points.filter((z) => z.id !== p.id); })}>✕</button>
            </div>
          ))}
        </div>
        <button className="small" data-testid="cursor-add-point" title="Add a point after the last one" onClick={() => updateCursor(id, (l) => {
          const last = [...l.points].sort((a, b) => a.time - b.time).at(-1);
          l.points.push({ id: uid('pt'), x: (last?.x ?? 500) + 160, y: (last?.y ?? 500) - 60, time: Math.min(l.duration, (last?.time ?? 0) + 0.6) });
        })}>+ Add point</button>
      </Section>
      <Section title="Clicks" tip="Moments when the cursor clicks and a ripple appears.">
        <div className="ptlist" data-testid="cursor-clicks">
          {clicks.length === 0 && <p className="hint">No clicks yet.</p>}
          {clicks.map((c, i) => (
            <div className="ptrow clickrow" key={c.id} data-testid="cursor-click-row">
              <span>{i + 1}</span>
              <NumberField value={c.time} decimals={2} step={0.1} min={0} title="Click time (seconds into the layer)" onCommit={(v) => updateCursor(id, (l) => { const q = l.clicks.find((z) => z.id === c.id); if (q) q.time = v; })} />
              <span className="unit">s</span>
              <button className="icon" title="Remove this click" aria-label="Remove click" onClick={() => updateCursor(id, (l) => { l.clicks = l.clicks.filter((z) => z.id !== c.id); })}>✕</button>
            </div>
          ))}
        </div>
        <button className="small" data-testid="cursor-add-click" title="Add a click at the playhead position" onClick={() => updateCursor(id, (l) => { l.clicks.push({ id: uid('clk'), time: tl }); })}>+ Click at playhead</button>
      </Section>
    </>
  );
}

export function Phase2Sections({ ids }: { ids: string[]; locked?: boolean }) {
  const project = useEditor((s) => s.project);
  const layers = ids.map((i) => findLayer(project, i)?.layer).filter((l): l is NonNullable<typeof l> => !!l);
  const animatable = layers.filter((l) => l.type !== 'cursor').map((l) => l.id);
  const cursor = layers.length === 1 && layers[0].type === 'cursor' ? (layers[0] as CursorLayer) : null;
  return (
    <>
      {cursor && <CursorSection layer={cursor} />}
      {animatable.length > 0 && <PresetsSection ids={animatable} />}
      {layers.length >= 2 && <StaggerSection ids={ids} />}
    </>
  );
}
