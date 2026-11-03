import { animatableProps, findKeyframeIndex, PROP_META, resolveLayer } from '../shared/animation';
import { FONT_FAMILIES, FONT_WEIGHTS } from '../shared/factory';
import type { Layer } from '../shared/schema';
import { EasingEditor } from './EasingEditor';
import { pickFile } from './Preview';
import { Phase2Sections } from './Phase2';
import {
  beginTx, clearKeyframes, endTx, findLayer, relinkAsset, renameLayer, renameScene, setAnchor, setKeyframeEasing, setLayerTiming,
  setProps, setScenesTiming, toggleKeyframe, useEditor, localTime,
} from './store';
import { ColorField, NumberField, Row, Section, TextField } from './ui';

/** Everything the property rows need, computed once per render. */
function useSel() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const time = useEditor((s) => s.time);
  const found = selection.map((id) => findLayer(project, id)).filter((x): x is NonNullable<ReturnType<typeof findLayer>> => !!x);
  const first = found[0] ?? null;
  const tl = first ? localTime(project, first.scene, first.layer, time) : 0;
  const resolved = first ? resolveLayer(first.layer, Math.max(0, Math.min(first.layer.duration, tl))) : null;
  return { project, found, first, resolved, ids: found.map((f) => f.layer.id), tl, time, fps: project.settings.fps };
}
type Sel = ReturnType<typeof useSel>;

function KfToggle({ sel, prop }: { sel: Sel; prop: string }) {
  const { first, ids, tl, fps } = sel;
  if (!first || !animatableProps(first.layer.type).includes(prop)) return <span className="kf-spacer" />;
  const list = first.layer.keyframes[prop];
  const at = findKeyframeIndex(list, tl, 0.5 / fps) >= 0;
  const label = PROP_META[prop]?.label ?? prop;
  return (
    <span className="kfctl">
      <button
        type="button"
        className={`kftoggle ${at ? 'on' : list?.length ? 'has' : ''}`}
        data-testid={`kf-toggle-${prop}`}
        aria-pressed={at}
        title={at ? `Remove the ${label} keyframe at the playhead` : `Add a ${label} keyframe at the playhead. Once a property has keyframes, changing it at another time adds a keyframe automatically.`}
        disabled={first.layer.locked}
        onClick={() => toggleKeyframe(ids, prop)}
      >◆</button>
    </span>
  );
}

function Num({ sel, prop, label, tip, step = 1, min, max, mult = 1, decimals = 2, unit }: {
  sel: Sel; prop: string; label: string; tip: string; step?: number; min?: number; max?: number; mult?: number; decimals?: number; unit?: string;
}) {
  const r = sel.resolved as any;
  const locked = !!sel.first?.layer.locked;
  return (
    <Row label={label} tip={tip}>
      <NumberField
        testId={`prop-${prop}`}
        value={(r[prop] as number) * mult}
        step={step}
        min={min}
        max={max}
        decimals={decimals}
        disabled={locked}
        title={tip}
        onCommit={(v) => setProps(sel.ids, { [prop]: v / mult })}
      />
      {unit && <span className="unit">{unit}</span>}
      <KfToggle sel={sel} prop={prop} />
    </Row>
  );
}

function Col({ sel, prop, label, tip }: { sel: Sel; prop: string; label: string; tip: string }) {
  const r = sel.resolved as any;
  return (
    <Row label={label} tip={tip}>
      <ColorField testId={`prop-${prop}`} value={r[prop]} title={tip} disabled={!!sel.first?.layer.locked} onChange={(v) => setProps(sel.ids, { [prop]: v })} />
      <KfToggle sel={sel} prop={prop} />
    </Row>
  );
}

function Sel1<T extends string | number>({ value, options, onChange, title, testId, disabled }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; title: string; testId?: string; disabled?: boolean;
}) {
  return (
    <select value={String(value)} title={title} data-testid={testId} disabled={disabled}
      onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

/** Text area that updates the preview live; the whole editing session is one undo step. */
function ContentField({ sel }: { sel: Sel }) {
  const l = sel.resolved as Extract<Layer, { type: 'text' }>;
  return (
    <textarea
      className="content"
      data-testid="prop-content"
      rows={3}
      title="The words shown on screen. Press Enter for a new line."
      disabled={sel.first?.layer.locked}
      value={l.content}
      onFocus={() => beginTx()}
      onBlur={() => endTx()}
      onChange={(e) => { beginTx(); setProps(sel.ids, { content: e.target.value }); }}
    />
  );
}

function AnchorGrid({ sel }: { sel: Sel }) {
  const a = sel.first!.layer.anchor;
  return (
    <div className="anchorgrid" title="Pivot point used for position, scale and rotation. Changing it does not move the layer.">
      {[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => (
        <button key={`${x}-${y}`} type="button" data-testid={`anchor-${x}-${y}`}
          className={a.x === x && a.y === y ? 'on' : ''}
          title={`Pivot at ${y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} ${x === 0 ? 'left' : x === 1 ? 'right' : 'center'}`}
          disabled={sel.first!.layer.locked}
          onClick={() => setAnchor(sel.first!.layer.id, x, y)} />
      )))}
    </div>
  );
}

function KeyframesAtPlayhead({ sel }: { sel: Sel }) {
  const { first, tl, fps } = sel;
  if (!first) return null;
  const rows = animatableProps(first.layer.type).flatMap((prop) => {
    const list = first.layer.keyframes[prop];
    const i = findKeyframeIndex(list, tl, 0.5 / fps);
    return i >= 0 ? [{ prop, kf: list[i], last: i === list.length - 1 }] : [];
  });
  return (
    <Section title="Keyframe easing" tip="How the value travels from a keyframe to the next one.">
      {rows.length === 0 && <p className="hint">Move the playhead onto a keyframe (click a ◆ in the timeline) to choose how the motion eases from it.</p>}
      {rows.map(({ prop, kf, last }) => (
        <div key={prop} className="kfease" data-testid={`easing-${prop}`}>
          <div className="kfease-head">
            <strong>{PROP_META[prop]?.label ?? prop}</strong>
            <span className="muted">{kf.time.toFixed(2)}s{kf.preset ? ` · preset ${kf.preset}` : ''}</span>
          </div>
          {last
            ? <p className="hint">This is the last keyframe, so there is no motion after it.</p>
            : <EasingEditor easing={kf.easing} disabled={first.layer.locked} onChange={(e) => setKeyframeEasing(first.layer.id, prop, kf.time, e)} />}
          <button className="small" title="Delete every keyframe of this property (the value at the playhead is kept)" onClick={() => clearKeyframes(first.layer.id, prop)}>Remove all {PROP_META[prop]?.label.toLowerCase()} keyframes</button>
        </div>
      ))}
    </Section>
  );
}

function ScenePanel() {
  const project = useEditor((s) => s.project);
  const sc = useEditor((s) => project.scenes.find((x) => x.id === s.activeSceneId) ?? null);
  if (!sc) return <p className="hint pad">Add a scene to get started.</p>;
  return (
    <>
      <Section title="Scene" tip="Scene timing on the project timeline.">
        <Row label="Name" tip="Scene name"><TextField value={sc.name} title="Scene name" onCommit={(v) => renameScene(sc.id, v)} /></Row>
        <Row label="Start" tip="Where this scene begins on the project timeline (seconds)">
          <NumberField value={sc.start} step={0.1} min={0} onCommit={(v) => setScenesTiming([{ id: sc.id, start: v, duration: sc.duration }])} /><span className="unit">s</span>
        </Row>
        <Row label="Duration" tip="How long this scene lasts (seconds)">
          <NumberField value={sc.duration} step={0.1} min={0.05} onCommit={(v) => setScenesTiming([{ id: sc.id, start: sc.start, duration: v }])} /><span className="unit">s</span>
        </Row>
      </Section>
      <p className="hint pad">Select a layer in the preview, timeline or layers list to edit it.</p>
    </>
  );
}

export function Properties() {
  const sel = useSel();
  const { first, resolved, found } = sel;
  const project = sel.project;
  const missing = useEditor((s) => s.missingAssets);
  if (!first || !resolved) return <aside className="right" data-testid="properties"><ScenePanel /></aside>;
  const layer = first.layer;
  const r = resolved as any;
  const locked = layer.locked;
  const type = layer.type;
  const fonts = [...FONT_FAMILIES, ...project.assets.filter((a) => a.type === 'font').map((a) => a.family || a.originalName.replace(/\.[^.]+$/, ''))];
  const asset = type === 'image' ? project.assets.find((a) => a.id === (layer as any).assetId) : undefined;

  return (
    <aside className="right" data-testid="properties">
      <fieldset disabled={locked} className="lockwrap">
        <Section title={found.length > 1 ? `${found.length} layers selected` : 'Layer'}>
          <Row label="Name" tip="Layer name">
            <TextField value={layer.name} title="Layer name" testId="prop-name" disabled={locked || found.length > 1}
              onCommit={(v) => renameLayer(layer.id, v)} />
          </Row>
          {locked && <p className="hint">🔒 Locked — unlock it in the layers list to edit.</p>}
        </Section>

        {type !== 'cursor' && (
          <Section title="Transform" tip="Where the layer sits, how big, how rotated, how see-through.">
            <Num sel={sel} prop="x" label="X" tip="Horizontal position of the pivot, in project pixels" step={10} decimals={1} />
            <Num sel={sel} prop="y" label="Y" tip="Vertical position of the pivot, in project pixels" step={10} decimals={1} />
            <Num sel={sel} prop="scale" label="Scale" tip="Size multiplier around the pivot (100% = original size)" step={5} mult={100} min={1} decimals={1} unit="%" />
            <Num sel={sel} prop="rotation" label="Rotation" tip="Rotation around the pivot, in degrees" step={5} decimals={1} unit="°" />
            <Num sel={sel} prop="opacity" label="Opacity" tip="0% = invisible, 100% = fully visible" step={5} mult={100} min={0} max={100} decimals={1} unit="%" />
            <Row label="Pivot" tip="Pivot point of the layer"><AnchorGrid sel={sel} /></Row>
          </Section>
        )}
        {type === 'cursor' && (
          <Section title="Cursor look" tip="The cursor path and clicks are edited below.">
            <Num sel={sel} prop="scale" label="Size" tip="Cursor size multiplier" step={0.1} min={0.1} decimals={2} />
            <Num sel={sel} prop="opacity" label="Opacity" tip="0% = invisible, 100% = fully visible" step={5} mult={100} min={0} max={100} decimals={1} unit="%" />
          </Section>
        )}

        {type === 'text' && (
          <Section title="Typography" tip="How the words look.">
            <ContentField sel={sel} />
            <Row label="Font" tip="Typeface. Fonts you import appear at the end of the list.">
              <Sel1 value={r.fontFamily} title="Typeface" testId="prop-fontFamily" options={fonts.map((f) => ({ value: f, label: f }))} onChange={(v) => setProps(sel.ids, { fontFamily: v })} />
            </Row>
            <Num sel={sel} prop="fontSize" label="Size" tip="Font size in project pixels" step={4} min={1} decimals={1} unit="px" />
            <Row label="Weight" tip="Boldness of the letters (400 normal, 700 bold)">
              <Sel1 value={r.fontWeight} title="Font weight" testId="prop-fontWeight" options={FONT_WEIGHTS.map((w) => ({ value: w, label: String(w) }))} onChange={(v) => setProps(sel.ids, { fontWeight: v })} />
            </Row>
            <Row label="Align" tip="How lines of text line up with each other">
              <span className="seg">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button key={a} type="button" className={r.align === a ? 'on' : ''} data-testid={`align-${a}`} title={`Align text ${a}`} onClick={() => setProps(sel.ids, { align: a })}>
                    {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
                  </button>
                ))}
              </span>
            </Row>
            <Num sel={sel} prop="lineHeight" label="Line height" tip="Space between lines, as a multiple of the font size" step={0.05} min={0.1} decimals={2} />
            <Num sel={sel} prop="letterSpacing" label="Spacing" tip="Extra space between letters, in pixels (can be negative)" step={1} decimals={1} unit="px" />
            <Col sel={sel} prop="color" label="Color" tip="Text color" />
          </Section>
        )}

        {type === 'shape' && (
          <Section title="Shape" tip="Fill, outline and size of the shape.">
            <Row label="Type" tip="Which shape to draw">
              <Sel1 value={r.shape} title="Shape type" testId="prop-shape" options={[{ value: 'rect', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'triangle', label: 'Triangle' }]} onChange={(v) => setProps(sel.ids, { shape: v })} />
            </Row>
            <Num sel={sel} prop="width" label="Width" tip="Shape width before scaling, in project pixels" step={10} min={1} decimals={1} unit="px" />
            <Num sel={sel} prop="height" label="Height" tip="Shape height before scaling, in project pixels" step={10} min={1} decimals={1} unit="px" />
            <Col sel={sel} prop="fill" label="Fill" tip="Inside color" />
            <Col sel={sel} prop="stroke" label="Outline" tip="Outline color" />
            <Num sel={sel} prop="strokeWidth" label="Outline size" tip="Outline thickness in pixels (0 = no outline)" step={1} min={0} decimals={1} unit="px" />
            {r.shape === 'rect' && <Num sel={sel} prop="cornerRadius" label="Corners" tip="Corner rounding in pixels" step={2} min={0} decimals={1} unit="px" />}
          </Section>
        )}

        {type === 'image' && (
          <Section title="Image" tip="Display size of the image.">
            <Row label="File" tip="Original imported file name"><span className="filename" title={asset?.originalName}>{asset?.originalName ?? '—'}</span></Row>
            <Num sel={sel} prop="width" label="Width" tip="Display width before scaling, in project pixels" step={10} min={1} decimals={1} unit="px" />
            <Num sel={sel} prop="height" label="Height" tip="Display height before scaling, in project pixels" step={10} min={1} decimals={1} unit="px" />
            {asset && missing.includes(asset.id) && (
              <button className="small danger" data-testid="relink-prop" title="The image file is missing. Pick a replacement." onClick={() => pickFile('.png,.jpg,.jpeg,.webp,.svg', (f) => void relinkAsset(asset.id, f))}>Relink missing file…</button>
            )}
          </Section>
        )}

        <Section title="Timing" tip="When this layer appears, relative to its scene.">
          <Row label="Start" tip="Seconds after the scene starts when the layer appears">
            <NumberField testId="prop-start" value={layer.start} step={0.1} min={0} disabled={locked} onCommit={(v) => setLayerTiming(layer.id, v, layer.duration)} /><span className="unit">s</span>
          </Row>
          <Row label="Duration" tip="How long the layer stays on screen (seconds)">
            <NumberField testId="prop-duration" value={layer.duration} step={0.1} min={0.05} disabled={locked} onCommit={(v) => setLayerTiming(layer.id, layer.start, v)} /><span className="unit">s</span>
          </Row>
        </Section>

        <KeyframesAtPlayhead sel={sel} />
        <Phase2Sections ids={sel.ids} locked={locked} />
      </fieldset>
    </aside>
  );
}

