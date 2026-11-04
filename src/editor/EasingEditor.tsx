import { defaultEasing, EASING_LABELS, evalEasing } from '../shared/easing';
import type { Easing } from '../shared/schema';
import { NumberField } from './ui';

const W = 132, H = 84, PAD = 10;

/** Live curve preview: x = time within the segment, y = eased progress (springs overshoot beyond 1). */
export function CurvePreview({ easing }: { easing: Easing }) {
  const N = 64;
  const ys: number[] = [];
  for (let i = 0; i <= N; i++) ys.push(evalEasing(easing, i / N));
  const lo = Math.min(0, ...ys), hi = Math.max(1, ...ys);
  const sy = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD);
  const sx = (u: number) => PAD + u * (W - 2 * PAD);
  const d = ys.map((v, i) => `${i ? 'L' : 'M'}${sx(i / N).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  return (
    <svg className="curve" width={W} height={H} viewBox={`0 0 ${W} ${H}`} data-testid="curve-preview" aria-label="Easing curve preview">
      <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(0)} className="guide" />
      <line x1={sx(0)} y1={sy(1)} x2={sx(1)} y2={sy(1)} className="guide" />
      <path d={d} className="line" fill="none" />
      <circle cx={sx(0)} cy={sy(0)} r={3} className="dot" />
      <circle cx={sx(1)} cy={sy(1)} r={3} className="dot" />
    </svg>
  );
}

const TYPES: Easing['type'][] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier', 'spring'];

export function EasingEditor({ easing, onChange, disabled }: { easing: Easing; onChange: (e: Easing) => void; disabled?: boolean }) {
  const meta = EASING_LABELS[easing.type];
  return (
    <div className="easing" data-testid="easing-editor">
      <CurvePreview easing={easing} />
      <div className="easing-ctl">
        <select
          value={easing.type}
          disabled={disabled}
          title="How the value speeds up or slows down on its way to the next keyframe"
          data-testid="easing-select"
          onChange={(e) => onChange(defaultEasing(e.target.value as Easing['type']))}
        >
          {TYPES.map((t) => <option key={t} value={t}>{EASING_LABELS[t].label}</option>)}
        </select>
        <p className="hint">{meta.hint}</p>
        {easing.type === 'cubic-bezier' && (
          <div className="grid4">
            {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
              <label key={k} title={k.startsWith('x') ? 'Horizontal handle position (0–1)' : 'Vertical handle position (below 0 / above 1 overshoots)'}>
                {k}
                <NumberField value={easing[k]} step={0.05} min={k.startsWith('x') ? 0 : -2} max={k.startsWith('x') ? 1 : 3} disabled={disabled}
                  onCommit={(v) => onChange({ ...easing, [k]: v })} />
              </label>
            ))}
          </div>
        )}
        {easing.type === 'spring' && (
          <div className="grid3">
            <label title="Higher = snappier, faster spring">Stiffness
              <NumberField value={easing.stiffness} step={10} min={1} max={2000} decimals={0} disabled={disabled} onCommit={(v) => onChange({ ...easing, stiffness: v })} />
            </label>
            <label title="Higher = less wobble. Low values bounce for longer">Damping
              <NumberField value={easing.damping} step={1} min={0} max={200} decimals={1} disabled={disabled} onCommit={(v) => onChange({ ...easing, damping: v })} />
            </label>
            <label title="Higher = heavier, slower to move and settle">Mass
              <NumberField value={easing.mass} step={0.1} min={0.1} max={20} decimals={2} disabled={disabled} onCommit={(v) => onChange({ ...easing, mass: v })} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
