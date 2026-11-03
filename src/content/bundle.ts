/**
 * То, что приложение загружает в браузере: собранный и проверенный город
 * (public/data/<город>.<хэш>.json) и список городов (public/data/cities.json).
 * Собирает tools/build-content.ts из исходников content/.
 */
import type { CityT, LatLonT, PlaceT, RouteT } from './schema';

export const BUNDLE_FORMAT = 1;

/** Объект без редакционных пометок. */
export type PlaceData = Omit<PlaceT, 'editorial'> & {
  /** Озвученный рассказ (адрес относительно сайта), если он есть. */
  audio?: string;
};

/** [широта, долгота]. */
export type PtData = [number, number];

/** Участок маршрута между соседними остановками — по улицам. */
export type LegData = { meters: number; points: PtData[] };

export type RouteData = RouteT & {
  /** Длина пути по улицам, м (без графа улиц — по прямой с поправкой ×1,3). */
  distance_m: number;
  /** Участки между соседними остановками; пусто, если у города нет графа улиц. */
  legs: LegData[];
  /** Длительность с остановками и рассказами, мин. */
  duration_min: number;
  /** true — длительность посчитана, а не задана редакцией. */
  duration_estimated: boolean;
};

export type CityBundle = {
  format: typeof BUNDLE_FORMAT;
  city: Omit<CityT, 'editorial'>;
  places: PlaceData[];
  routes: RouteData[];
  /** Файл графа улиц для путей «от меня до точки» (data/…), если есть. */
  streets: string | null;
  /** Своя подложка карты (map/<город>/style.json), если есть. */
  map_style: string | null;
  /** Озвученные фразы навигатора: ключ → адрес файла. */
  phrases: Record<string, string>;
};

export type CityIndexEntry = {
  id: string;
  name: string;
  name_prepositional: string;
  region: string;
  center: LatLonT;
  bbox: CityT['bbox'];
  places: number;
  routes: number;
  /** Имя файла города с хэшем содержимого — браузер не застрянет на старой версии. */
  bundle: string;
};

export type CitiesIndexData = {
  format: typeof BUNDLE_FORMAT;
  cities: CityIndexEntry[];
};
