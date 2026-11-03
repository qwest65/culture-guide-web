/**
 * То, что приложение загружает в браузере: собранный и проверенный город
 * (public/data/<город>.<хэш>.json) и список городов (public/data/cities.json).
 * Собирает tools/build-content.ts из исходников content/.
 */
import type { CityT, LatLonT, PlaceT, RouteT } from './schema';

export const BUNDLE_FORMAT = 1;

/** Объект без редакционных пометок. */
export type PlaceData = Omit<PlaceT, 'editorial'>;

export type RouteData = RouteT & {
  /** Длина по прямой между точками с поправкой на улицы, м (пока нет пешеходного графа). */
  distance_m: number;
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
