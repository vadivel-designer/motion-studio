import { evalEasing } from './easing';
import type { CursorPoint } from './schema';

export interface Pt { x: number; y: number }
const EASE = { type: 'ease-in-out' } as const;

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const u2 = u * u, u3 = u2 * u;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

export const sortedPoints = (points: readonly CursorPoint[]) => [...points].sort((a, b) => a.time - b.time);

/** Cursor position at layer-local time t. smoothing 0 = straight segments, 1 = Catmull-Rom spline. */
export function cursorPosition(points: readonly CursorPoint[], t: number, smoothing: number): Pt | null {
  if (points.length === 0) return null;
  const p = sortedPoints(points);
  if (t <= p[0].time) return { x: p[0].x, y: p[0].y };
  const last = p[p.length - 1];
  if (t >= last.time) return { x: last.x, y: last.y };
  let i = 0;
  while (i < p.length - 2 && t >= p[i + 1].time) i++;
  const a = p[i], b = p[i + 1];
  const span = b.time - a.time;
  const u = span <= 0 ? 1 : evalEasing(EASE, (t - a.time) / span);
  const lin = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  if (smoothing <= 0) return lin;
  const sp = catmull(p[Math.max(0, i - 1)], a, b, p[Math.min(p.length - 1, i + 2)], u);
  return { x: lin.x + (sp.x - lin.x) * smoothing, y: lin.y + (sp.y - lin.y) * smoothing };
}

/** Polyline sampled along the cursor path (for editor overlay). */
export function samplePath(points: readonly CursorPoint[], smoothing: number, steps = 24): Pt[] {
  const p = sortedPoints(points);
  if (p.length < 2) return p.map((q) => ({ x: q.x, y: q.y }));
  const out: Pt[] = [];
  const total = p[p.length - 1].time - p[0].time;
  const n = Math.max(2, steps * (p.length - 1));
  for (let i = 0; i <= n; i++) {
    const pos = cursorPosition(p, p[0].time + (total * i) / n, smoothing);
    if (pos) out.push(pos);
  }
  return out;
}
