import type { LatLonT } from '../content/schema';
import { distanceMeters } from './geo';

/**
 * Оценка длины и времени маршрута, пока нет пешеходного графа улиц.
 * Когда появятся пути из OSM (как в «Маленьком караване»), длина будет браться из них.
 */
export const DETOUR_FACTOR = 1.3; // улицы длиннее прямой
export const WALK_M_PER_MIN = 70; // 4,2 км/ч — неспешная прогулка
export const SPEECH_CHARS_PER_SEC = 14; // темп диктора
export const STOP_OVERHEAD_MIN = 2; // осмотреться, перейти к следующей точке

export function routeDistanceMeters(points: LatLonT[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distanceMeters(points[i - 1], points[i]);
  return Math.round(sum * DETOUR_FACTOR);
}

export function listenMinutes(text: string): number {
  return text.length / SPEECH_CHARS_PER_SEC / 60;
}

/** Полная длительность: ходьба + рассказы + остановки, с округлением до 5 мин. */
export function routeDurationMinutes(distanceM: number, storyChars: number[]): number {
  const walk = distanceM / WALK_M_PER_MIN;
  const listen = storyChars.reduce((s, n) => s + n / SPEECH_CHARS_PER_SEC / 60, 0);
  const total = walk + listen + storyChars.length * STOP_OVERHEAD_MIN;
  return Math.max(5, Math.round(total / 5) * 5);
}
