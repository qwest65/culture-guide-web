/**
 * Логика ведения по маршруту, без зависимостей от браузера: по очередной геопозиции
 * решает, достигнута ли текущая цель, и переключает маршрут на следующую точку.
 *
 * Перенесено из Android-версии (GuidanceEngine.kt) с уроком «Маленького каравана»:
 * прибытие засчитывается, только если человек пробыл в радиусе несколько секунд подряд —
 * одиночный скачок GPS к точке не даёт ложного прибытия.
 */
import type { LatLonT } from '../content/schema';
import { distanceMeters } from './geo';

export type Stop = LatLonT & { radiusM?: number };

export type Fix = LatLonT & {
  /** Погрешность, м (GeolocationCoordinates.accuracy). */
  accuracyM?: number;
  /** Время отметки, мс. */
  time: number;
};

export type GuidanceState = {
  /** Индекс текущей цели; равен числу точек, когда маршрут пройден. */
  active: number;
  /** Точка, в радиусе которой человек сейчас стоит, и с какого момента. */
  dwell: { index: number; since: number } | null;
};

export type GuidanceUpdate = {
  state: GuidanceState;
  /** Точки, отмеченные пройденными этой отметкой (срезанные тоже). */
  reached: number[];
  /** Расстояние по прямой до текущей цели; null, если маршрут пройден. */
  distanceM: number | null;
  finished: boolean;
};

export type GuidanceOptions = {
  arrivalRadiusM: number;
  /** Сколько стоять в радиусе, чтобы прибытие засчиталось. */
  dwellMs: number;
  /** Отметки хуже этой точности не переключают цели — только обновляют расстояние. */
  maxUsableAccuracyM: number;
  /** Сколько следующих точек проверять, чтобы засчитать срезанный путь. */
  lookAhead: number;
};

export const DEFAULT_GUIDANCE: GuidanceOptions = {
  arrivalRadiusM: 45,
  dwellMs: 5000,
  maxUsableAccuracyM: 80,
  lookAhead: 2,
};

export const initialGuidance = (active = 0): GuidanceState => ({ active, dwell: null });

export function updateGuidance(
  stops: Stop[],
  state: GuidanceState,
  fix: Fix,
  opts: GuidanceOptions = DEFAULT_GUIDANCE,
): GuidanceUpdate {
  const active = Math.max(0, Math.min(state.active, stops.length));
  if (active >= stops.length) {
    return { state: { active, dwell: null }, reached: [], distanceM: null, finished: stops.length > 0 };
  }

  let next: GuidanceState = { active, dwell: state.dwell };
  const reached: number[] = [];
  const usable = fix.accuracyM === undefined || fix.accuracyM <= opts.maxUsableAccuracyM;

  if (usable) {
    // Самая дальняя точка из ближайших, в радиусе которой человек находится.
    let inside = -1;
    const last = Math.min(active + opts.lookAhead, stops.length - 1);
    for (let i = active; i <= last; i++) {
      const radius = stops[i].radiusM ?? opts.arrivalRadiusM;
      if (distanceMeters(stops[i], fix) <= radius) inside = i;
    }
    if (inside < 0) {
      next.dwell = null;
    } else if (next.dwell?.index !== inside) {
      next.dwell = { index: inside, since: fix.time };
    }
    if (next.dwell && fix.time - next.dwell.since >= opts.dwellMs) {
      for (let i = active; i <= next.dwell.index; i++) reached.push(i);
      next = { active: next.dwell.index + 1, dwell: null };
    }
  }
  // Неточная отметка не сбрасывает и не продлевает ожидание: её просто пропускаем.

  const finished = next.active >= stops.length;
  return {
    state: next,
    reached,
    distanceM: finished ? null : distanceMeters(stops[next.active], fix),
    finished,
  };
}

/** «Я на месте» — когда геопозиции нет или она неточная. */
export function arriveManually(stops: Stop[], state: GuidanceState): GuidanceUpdate {
  const active = Math.max(0, Math.min(state.active, stops.length));
  if (active >= stops.length) return { state: { active, dwell: null }, reached: [], distanceM: null, finished: true };
  const next = { active: active + 1, dwell: null };
  return { state: next, reached: [active], distanceM: null, finished: next.active >= stops.length };
}

/** Оставшийся путь: до текущей цели плюс участки после неё (участок i ведёт от точки i к i + 1). */
export function remainingMeters(distanceToTarget: number, active: number, legsM: number[]): number {
  let total = distanceToTarget;
  for (let i = active; i < legsM.length; i++) total += legsM[i];
  return total;
}
