import type { LatLonT } from '../content/schema';

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Расстояние по поверхности Земли, м (формула гаверсинуса). */
export function distanceMeters(a: LatLonT, b: LatLonT): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type BBox = { south: number; west: number; north: number; east: number };

export function inBBox(p: LatLonT, b: BBox): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
}

/** Дальше этого от центра город не предлагаем автоматически. */
export const CITY_DETECT_MAX_M = 40_000;

/**
 * Какой город предложить по геопозиции: тот, в чьём районе человек находится,
 * иначе ближайший в пределах {@link CITY_DETECT_MAX_M}. null — рядом наших городов нет.
 */
export function detectCity<C extends { center: LatLonT; bbox: BBox }>(cities: C[], here: LatLonT): C | null {
  let best: C | null = null;
  let bestDist = Infinity;
  for (const c of cities) {
    const d = distanceMeters(here, c.center);
    if (inBBox(here, c.bbox)) return c;
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return bestDist <= CITY_DETECT_MAX_M ? best : null;
}
