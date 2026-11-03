/**
 * Пешеходные пути по улицам города — прямо в телефоне, без внешних сервисов.
 *
 * Граф улиц строит tools/build_streets.py из OpenStreetMap: только улицы, тротуары, пешеходные
 * зоны и дорожки скверов, без дворов и проездов; главные улицы «дешевле» переулков.
 * Перенесено из «Маленького каравана» (StreetGraph, WalkPath, повороты).
 */
import { distanceMeters } from './geo';

/** [широта, долгота] — как в файлах графа и в «Караване». */
export type Pt = [number, number];

const rad = (d: number) => (d * Math.PI) / 180;
export const dist = (a: Pt, b: Pt) => distanceMeters({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });

/** Граф улиц из streets.json: nodes — широта, долгота подряд; edges — узел, узел, «цена» ×100. */
export type StreetsData = { source?: string; nodes: number[]; edges: number[] };

type Snap = { e: number; t: number; d: number; p: Pt };

export class StreetGraph {
  private lat: Float64Array;
  private lon: Float64Array;
  private a: Int32Array;
  private b: Int32Array;
  private cost: Float64Array;
  private start: Int32Array;
  private adj: Int32Array;

  constructor({ nodes, edges }: StreetsData) {
    const n = nodes.length / 2;
    const m = edges.length / 3;
    this.lat = new Float64Array(n);
    this.lon = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.lat[i] = nodes[2 * i];
      this.lon[i] = nodes[2 * i + 1];
    }
    this.a = new Int32Array(m);
    this.b = new Int32Array(m);
    this.cost = new Float64Array(m);
    const deg = new Int32Array(n + 1);
    for (let e = 0; e < m; e++) {
      const a = edges[3 * e];
      const b = edges[3 * e + 1];
      this.a[e] = a;
      this.b[e] = b;
      this.cost[e] = (dist([this.lat[a], this.lon[a]], [this.lat[b], this.lon[b]]) * edges[3 * e + 2]) / 100;
      deg[a + 1]++;
      deg[b + 1]++;
    }
    for (let i = 1; i <= n; i++) deg[i] += deg[i - 1];
    this.start = deg;
    this.adj = new Int32Array(m * 2);
    const fill = deg.slice();
    for (let e = 0; e < m; e++) {
      this.adj[fill[this.a[e]]++] = e;
      this.adj[fill[this.b[e]]++] = e;
    }
  }

  get size() {
    return { nodes: this.lat.length, edges: this.a.length };
  }

  /** Ближайшая точка сети. */
  snap(p: Pt): Snap | null {
    let best: Snap | null = null;
    const kx = 111_320 * Math.cos(rad(p[0]));
    for (let e = 0; e < this.a.length; e++) {
      const a = this.a[e];
      const b = this.b[e];
      const bx = (this.lon[b] - this.lon[a]) * kx;
      const by = (this.lat[b] - this.lat[a]) * 111_320;
      const px = (p[1] - this.lon[a]) * kx;
      const py = (p[0] - this.lat[a]) * 111_320;
      const len2 = bx * bx + by * by;
      const t = len2 === 0 ? 0 : Math.min(Math.max((px * bx + py * by) / len2, 0), 1);
      const d = Math.hypot(px - t * bx, py - t * by);
      if (!best || d < best.d) {
        best = {
          e,
          t,
          d,
          p: [this.lat[a] + (this.lat[b] - this.lat[a]) * t, this.lon[a] + (this.lon[b] - this.lon[a]) * t],
        };
      }
    }
    return best;
  }

  /** Путь по улицам от from до to; null — одна из точек дальше maxSnap метров от улиц города. */
  route(from: Pt, to: Pt, maxSnap = 150): Pt[] | null {
    const s = this.snap(from);
    const g = this.snap(to);
    if (!s || !g || s.d > maxSnap || g.d > maxSnap) return null;
    const middle: Pt[] = s.e === g.e ? [s.p, g.p] : [s.p, ...this.shortest(s, g), g.p];
    const out: Pt[] = [from];
    for (const p of [...middle, to]) if (dist(out[out.length - 1], p) > 0.5) out.push(p);
    if (out.length < 2) out.push(to);
    return despike(out);
  }

  /** Путь через промежуточные точки (для участков, проложенных на месте вручную). */
  routeVia(points: Pt[]): Pt[] | null {
    let out: Pt[] = [];
    for (let i = 1; i < points.length; i++) {
      const part = this.route(points[i - 1], points[i]);
      if (!part) return null;
      out = out.length ? [...out, ...part.slice(1)] : part;
    }
    return despike(out);
  }

  /** Дейкстра между точками на разных отрезках. */
  private shortest(s: Snap, g: Snap): Pt[] {
    const n = this.lat.length;
    const best = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    const push = (node: number, cost: number, from: number) => {
      if (cost >= best[node]) return;
      best[node] = cost;
      prev[node] = from;
      heap.push(cost, node);
    };
    push(this.a[s.e], s.t * this.cost[s.e], -1);
    push(this.b[s.e], (1 - s.t) * this.cost[s.e], -1);
    const gA = this.a[g.e];
    const gB = this.b[g.e];
    const tailA = g.t * this.cost[g.e];
    const tailB = (1 - g.t) * this.cost[g.e];
    while (heap.size) {
      const [cost, u] = heap.pop();
      if (cost > best[u]) continue;
      if (best[gA] + tailA <= cost && best[gB] + tailB <= cost) break;
      for (let i = this.start[u]; i < this.start[u + 1]; i++) {
        const e = this.adj[i];
        push(this.a[e] === u ? this.b[e] : this.a[e], cost + this.cost[e], u);
      }
    }
    const end = best[gA] + tailA <= best[gB] + tailB ? gA : gB;
    if (best[end] === Infinity) return [];
    const chain: Pt[] = [];
    for (let k = end; k !== -1; k = prev[k]) chain.push([this.lat[k], this.lon[k]]);
    return chain.reverse();
  }
}

class MinHeap {
  private c: number[] = [];
  private v: number[] = [];
  get size() {
    return this.c.length;
  }
  push(cost: number, value: number) {
    const { c, v } = this;
    c.push(cost);
    v.push(value);
    let i = c.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (c[up] <= c[i]) break;
      [c[up], c[i]] = [c[i], c[up]];
      [v[up], v[i]] = [v[i], v[up]];
      i = up;
    }
  }
  pop(): [number, number] {
    const { c, v } = this;
    const top: [number, number] = [c[0], v[0]];
    const lc = c.pop()!;
    const lv = v.pop()!;
    if (c.length) {
      c[0] = lc;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < c.length && c[l] < c[m]) m = l;
        if (r < c.length && c[r] < c[m]) m = r;
        if (m === i) break;
        [c[m], c[i]] = [c[i], c[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Убирает «хвостики»: короткий заход в сторону и возврат по той же линии. */
export function despike(points: Pt[]): Pt[] {
  const pts = points.slice();
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const there = dist(pts[i - 1], pts[i]);
      const back = dist(pts[i], pts[i + 1]);
      if (Math.min(there, back) < 25 && dist(pts[i - 1], pts[i + 1]) < 0.3 * (there + back)) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function lineLength(points: Pt[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
  return sum;
}

/* ---------- Линия пути: где я на ней и что впереди ---------- */

export class WalkPath {
  readonly seg: number[] = [];
  readonly length: number;
  private maneuvers: Maneuver[] | null = null;

  constructor(readonly points: Pt[]) {
    for (let i = 0; i < points.length - 1; i++) this.seg.push(dist(points[i], points[i + 1]));
    this.length = this.seg.reduce((a, b) => a + b, 0);
  }

  pointAt(along: number): Pt {
    let left = Math.min(Math.max(along, 0), this.length);
    for (let i = 0; i < this.seg.length; i++) {
      const s = this.seg[i];
      if (left <= s || i === this.seg.length - 1) {
        const t = s === 0 ? 0 : Math.min(Math.max(left / s, 0), 1);
        const a = this.points[i];
        const b = this.points[i + 1];
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
      left -= s;
    }
    return this.points[this.points.length - 1];
  }

  remainingFrom(along: number): Pt[] {
    const out: Pt[] = [this.pointAt(along)];
    let passed = 0;
    for (let i = 0; i < this.seg.length; i++) {
      passed += this.seg[i];
      if (passed > along) out.push(this.points[i + 1]);
    }
    if (out.length < 2) out.push(this.points[this.points.length - 1]);
    return out;
  }

  /** Насколько точка в стороне от линии (off) и сколько осталось идти (remaining). */
  progress(p: Pt): { off: number; remaining: number; along: number } {
    let bestOff = Infinity;
    let bestRemaining = this.length;
    let after = this.length;
    for (let i = 0; i < this.seg.length; i++) {
      after -= this.seg[i];
      const a = this.points[i];
      const b = this.points[i + 1];
      const kx = 111_320 * Math.cos(rad(a[0]));
      const bx = (b[1] - a[1]) * kx;
      const by = (b[0] - a[0]) * 111_320;
      const px = (p[1] - a[1]) * kx;
      const py = (p[0] - a[0]) * 111_320;
      const len2 = bx * bx + by * by;
      const t = len2 === 0 ? 0 : Math.min(Math.max((px * bx + py * by) / len2, 0), 1);
      const off = Math.hypot(px - t * bx, py - t * by);
      if (off < bestOff) {
        bestOff = off;
        bestRemaining = (1 - t) * this.seg[i] + after;
      }
    }
    return { off: bestOff, remaining: bestRemaining, along: this.length - bestRemaining };
  }

  /** Ближайший поворот через inMeters или, если поворотов больше нет, сколько идти прямо. */
  nextInstruction(along: number): Instruction {
    this.maneuvers ??= findManeuvers(this);
    const next = this.maneuvers.find((m) => m.at > along - PASSED_M);
    if (!next) return { turn: null, inMeters: Math.max(this.length - along, 0), at: null };
    return { turn: next.turn, inMeters: Math.max(next.at - along, 0), at: next.at };
  }
}

/* ---------- Повороты ---------- */

export type Turn = 'left' | 'right' | 'slight_left' | 'slight_right' | 'u_turn';
export type Maneuver = { at: number; turn: Turn };
export type Instruction = { turn: Turn | null; inMeters: number; at: number | null };

const MIN_TURN_DEG = 30;
const SHARP_DEG = 60;
const U_TURN_DEG = 160;
/** Направление до и после излома — по отрезку такой длины, чтобы мелкие зигзаги не мешали. */
const WINDOW_M = 12;
const MERGE_M = 15;
const SKIP_START_M = 10;
const PASSED_M = 5;

export function bearingDegrees(a: Pt, b: Pt): number {
  const p1 = rad(a[0]);
  const p2 = rad(b[0]);
  const dl = rad(b[1] - a[1]);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Разница направлений −180..180; плюс — вправо. */
export function angleDelta(from: number, to: number): number {
  const d = (((to - from) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

function turnOf(delta: number): Turn {
  if (Math.abs(delta) >= U_TURN_DEG) return 'u_turn';
  if (delta <= -SHARP_DEG) return 'left';
  if (delta < 0) return 'slight_left';
  if (delta >= SHARP_DEG) return 'right';
  return 'slight_right';
}

export function findManeuvers(path: WalkPath): Maneuver[] {
  const pts = path.points;
  if (pts.length < 3) return [];
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + path.seg[i - 1]);
  const bends: { at: number; delta: number }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = at[i];
    if (d < SKIP_START_M || path.length - d < PASSED_M) continue;
    const before = path.pointAt(d - WINDOW_M);
    const after = path.pointAt(d + WINDOW_M);
    if (dist(before, pts[i]) < 1 || dist(pts[i], after) < 1) continue;
    const delta = angleDelta(bearingDegrees(before, pts[i]), bearingDegrees(pts[i], after));
    if (Math.abs(delta) >= MIN_TURN_DEG) bends.push({ at: d, delta });
  }
  const merged: typeof bends = [];
  for (const b of bends) {
    const last = merged[merged.length - 1];
    if (last && b.at - last.at < MERGE_M) {
      if (Math.abs(b.delta) > Math.abs(last.delta)) merged[merged.length - 1] = b;
    } else merged.push(b);
  }
  return merged.map((b) => ({ at: b.at, turn: turnOf(b.delta) }));
}
