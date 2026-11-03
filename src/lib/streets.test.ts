import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StreetGraph, WalkPath, dist, findManeuvers, lineLength, type Pt, type StreetsData } from './streets';

// Квадрат 100 × 100 м: улицы по сторонам и диагональ-«переулок» с ценой ×1,8.
const lat0 = 54.08;
const lon0 = 61.56;
const dLat = 100 / 111_320;
const dLon = 100 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const square: StreetsData = {
  nodes: [lat0, lon0, lat0, lon0 + dLon, lat0 + dLat, lon0 + dLon, lat0 + dLat, lon0],
  edges: [0, 1, 100, 1, 2, 100, 2, 3, 100, 3, 0, 100, 0, 2, 180],
};

describe('StreetGraph', () => {
  const g = new StreetGraph(square);

  it('путь по улицам обходит «дорогой» переулок', () => {
    const line = g.route([lat0, lon0], [lat0 + dLat, lon0 + dLon])!;
    // Диагональ 141 м × 1,8 = 255 «дороже» 200 м по сторонам квадрата.
    expect(lineLength(line)).toBeGreaterThan(190);
    expect(lineLength(line)).toBeLessThan(210);
  });

  it('точку дальше 150 м от улиц не ведёт', () => {
    expect(g.route([lat0, lon0], [lat0 + 0.01, lon0])).toBeNull();
  });

  it('граф улиц Троицка строит путь от камня крепости к собору', () => {
    const data = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../content/cities/troitsk/streets.json'), 'utf8'));
    const troitsk = new StreetGraph(data);
    const stone: Pt = [54.077456, 61.556294];
    const cathedral: Pt = [54.077776, 61.557391];
    const line = troitsk.route(stone, cathedral)!;
    expect(lineLength(line)).toBeLessThan(dist(stone, cathedral) * 2);
  });
});

describe('WalkPath', () => {
  // Сначала на восток 100 м, потом на север 100 м: один поворот налево.
  const path = new WalkPath([
    [lat0, lon0],
    [lat0, lon0 + dLon],
    [lat0 + dLat, lon0 + dLon],
  ]);

  it('положение на линии и остаток пути', () => {
    const pr = path.progress([lat0 + 5 / 111_320, lon0 + dLon / 2]);
    expect(pr.off).toBeCloseTo(5, 0);
    expect(pr.remaining).toBeCloseTo(150, 0);
  });

  it('находит поворот налево и подсказывает заранее', () => {
    expect(findManeuvers(path)).toEqual([{ at: expect.closeTo(100, 0), turn: 'left' }]);
    const next = path.nextInstruction(80);
    expect(next.turn).toBe('left');
    expect(next.inMeters).toBeCloseTo(20, 0);
    expect(path.nextInstruction(150).turn).toBeNull();
  });
});
