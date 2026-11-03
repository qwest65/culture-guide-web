/**
 * Формат «пакета города» — исходные файлы в content/cities/<id>/.
 *
 * Эти схемы — единственное описание формата: по ним проверяются исходники
 * (tools/build-content.ts) и из них же выводятся типы, которыми пользуется приложение.
 * Приложение импортирует отсюда только типы, сам zod в сборку для браузера не попадает.
 * Человеческое описание формата — docs/city-package.md.
 */
import { z } from 'zod';

/** Постоянный идентификатор: латиница, цифры, дефис. Попадает в адреса и QR-коды — не меняется. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'только строчная латиница, цифры и дефис: svyato-troitskiy-sobor');

/**
 * Готовность к показу:
 * draft — в работе, в приложение не попадает;
 * review — показывается, но редакционная проверка не закончена;
 * published — прошёл фактчекинг и проверку на месте.
 */
export const Status = z.enum(['draft', 'review', 'published']);

export const LatLon = z.object({
  lat: z.number().min(41).max(82),
  lon: z.number().min(19).max(180),
});

/** Дата: 1866 · 1754-05 · 1743-05-22 · 1908/1910 (период) · XVIII (век). */
export const HistDate = z
  .string()
  .regex(
    /^(\d{4}(-\d{2}(-\d{2})?)?(\/\d{4})?|[IVX]+)$/,
    'дата в виде 1866, 1754-05, 1743-05-22, 1908/1910 или век римскими цифрами',
  );

export const PlaceCategory = z.enum([
  'architecture',
  'religion',
  'history',
  'monument',
  'museum',
  'public-space',
  'nature',
]);

export const PersonRole = z.enum([
  'architect',
  'sculptor',
  'artist',
  'engineer',
  'customer', // заказчик, владелец
  'founder',
  'subject', // кому посвящён памятник, о ком рассказ
]);

export const Person = z.object({
  name: z.string().min(2),
  role: PersonRole,
  years: z.string().optional(),
  /** probable — «приписывается», «проект связывают с…». */
  attribution: z.enum(['certain', 'probable']).default('certain'),
});

export const Source = z.object({
  title: z.string().min(3),
  url: z.url().optional(),
  /** Автор, издательство, архив. */
  publisher: z.string().optional(),
  year: z.string().optional(),
});

/** Фото с правами. Своих фото нет — поэтому без автора и лицензии фото не принимается. */
export const Photo = z.object({
  src: z.string().min(1),
  kind: z.enum(['modern', 'archive']),
  caption: z.string().min(3),
  year: z.string().optional(),
  author: z.string().min(2),
  license: z.string().min(2),
  source_url: z.url().optional(),
});

/**
 * «Было/стало»: архивное фото поверх современного, снятых с одной точки.
 * viewpoint — где встать, чтобы ракурс совпал.
 */
export const ThenNow = z.object({
  then: Photo,
  now: Photo,
  viewpoint: LatLon,
  bearing: z.number().min(0).max(360).optional(),
});

export const Editorial = z
  .object({
    /** Откуда координата и проверена ли на месте. */
    location_source: z.string().optional(),
    /** Что осталось сделать. Видно в отчёте проверки, в приложении — нет. */
    todo: z.array(z.string()).default([]),
    fact_checked_by: z.string().optional(),
    fact_checked_on: z.string().optional(),
  })
  .default({ todo: [] });

export const Place = z.object({
  id: Slug,
  status: Status,
  name: z.string().min(2),
  category: PlaceCategory,
  address: z.string().min(2),
  /** Сам объект. */
  location: LatLon,
  /** Где встать и слушать, если это не у самого объекта (вход, сквер напротив). */
  listen_at: LatLon.optional(),
  /** Радиус прибытия, м. По умолчанию — радиус приложения. */
  arrival_radius_m: z.number().min(15).max(150).optional(),
  /** Одна строка для списков. */
  summary: z.string().min(10).max(160),
  /** Основной рассказ — абзацами. Его и озвучиваем у объекта. */
  story: z.array(z.string().min(20)).min(1),
  /** Короткая заметка (30–60 с) для «свободной прогулки». Без неё звучит summary. */
  note: z.string().min(20).max(700).optional(),
  dates: z.array(z.object({ date: HistDate, event: z.string().min(3) })).default([]),
  people: z.array(Person).default([]),
  heritage: z
    .object({
      level: z.enum(['federal', 'regional', 'local', 'identified']),
      /** Номер в Едином государственном реестре объектов культурного наследия. */
      registry_id: z.string().optional(),
    })
    .optional(),
  sources: z.array(Source).default([]),
  photos: z.array(Photo).default([]),
  then_now: z.array(ThenNow).default([]),
  editorial: Editorial,
});

export const Route = z.object({
  id: Slug,
  status: Status,
  title: z.string().min(3),
  description: z.string().min(10),
  /** id объектов по порядку. */
  stops: z.array(Slug).min(2),
  /** Ручная длительность, мин. Если нет — оценивается при сборке. */
  duration_min: z.number().int().positive().optional(),
});

export const City = z.object({
  id: Slug,
  status: Status,
  name: z.string().min(2),
  /** «в Троицке» — для фраз в интерфейсе. */
  name_prepositional: z.string().min(2),
  region: z.string().min(2),
  timezone: z.string().min(3),
  center: LatLon,
  /** Район, на который строятся карта и пешеходный граф. */
  bbox: z.object({ south: z.number(), west: z.number(), north: z.number(), east: z.number() }),
  intro: z.string().min(20),
  credits: z.array(z.object({ role: z.string(), name: z.string() })).default([]),
  editorial: Editorial,
});

export const Lexicon = z.object({
  note: z.string().optional(),
  entries: z.array(z.object({ text: z.string().min(1), say: z.string().min(1) })),
});

export const CitiesIndex = z.object({
  note: z.string().optional(),
  cities: z.array(Slug).min(1),
});

export const PlacesFile = z.object({ places: z.array(Place) });
export const RoutesFile = z.object({ routes: z.array(Route) });

export type LatLonT = z.infer<typeof LatLon>;
export type PlaceT = z.infer<typeof Place>;
export type RouteT = z.infer<typeof Route>;
export type CityT = z.infer<typeof City>;
export type LexiconT = z.infer<typeof Lexicon>;
export type PlaceCategoryT = z.infer<typeof PlaceCategory>;
export type PersonRoleT = z.infer<typeof PersonRole>;
