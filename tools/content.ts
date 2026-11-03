/**
 * Проверка и сборка пакета города — без чтения файлов, чтобы её можно было тестировать.
 * Файлы читает tools/build-content.ts.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AudioManifest,
  City,
  Lexicon,
  PlacesFile,
  RoutesFile,
  Streets,
  Walking,
  type CityT,
  type PlaceT,
} from '../src/content/schema';
import { BUNDLE_FORMAT, type CityBundle, type LegData, type PlaceData, type RouteData } from '../src/content/bundle';
import { inBBox } from '../src/lib/geo';
import { routeDistanceMeters, routeDurationMinutes } from '../src/lib/estimate';
import { StreetGraph, lineLength, type Pt } from '../src/lib/streets';

/** Текст, который озвучивается у объекта: название и рассказ. Так же считает tools/generate_audio.py. */
export const placeSpeech = (p: { name: string; story: string[] }) => `${p.name}. ${p.story.join(' ')}`;

/** Короткий хэш текста — по нему видно, что озвучка устарела. */
export const textHash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

export type RawCity = {
  folder: string;
  city: unknown;
  places: unknown;
  routes: unknown;
  lexicon?: unknown;
  walking?: unknown;
  /** Граф улиц (streets.json), если построен. */
  streets?: unknown;
  /** Что озвучено (public/audio/<город>/manifest.json). */
  audio?: unknown;
  /** Имя файла графа улиц в public/data, если граф есть. */
  streetsFile?: string;
  /** Есть ли своя подложка карты public/map/<город>/style.json. */
  hasMap?: boolean;
  /** Озвученные общие фразы: ключ → адрес. */
  phrases?: Record<string, string>;
  /** Существует ли файл в папке города (для фото). */
  fileExists: (relPath: string) => boolean;
  /** Существует ли файл в public/ (для озвучки). */
  publicExists?: (relPath: string) => boolean;
};

export type Report = { errors: string[]; warnings: string[]; todo: string[] };

export type CityResult = { bundle: CityBundle | null; lexicon: z.infer<typeof Lexicon> | null; report: Report };

function zodIssues(file: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${file}: ${i.path.join('.') || '(корень)'} — ${i.message}`);
}

const visible = <T extends { status: string }>(x: T) => x.status !== 'draft';

/** Что требуется от объекта со статусом published. */
function publishedGaps(p: PlaceT): string[] {
  const gaps: string[] = [];
  if (p.sources.length === 0) gaps.push('нет источников');
  if (!p.editorial.fact_checked_by) gaps.push('не указано, кто проверил факты (editorial.fact_checked_by)');
  if (p.editorial.todo.length > 0) gaps.push('есть незакрытые пункты editorial.todo');
  return gaps;
}

export function buildCity(raw: RawCity): CityResult {
  const report: Report = { errors: [], warnings: [], todo: [] };
  const dir = `content/cities/${raw.folder}`;

  const city = City.safeParse(raw.city);
  const places = PlacesFile.safeParse(raw.places);
  const routes = RoutesFile.safeParse(raw.routes);
  const lexicon = raw.lexicon === undefined ? null : Lexicon.safeParse(raw.lexicon);
  const walking = Walking.safeParse(raw.walking ?? {});
  const streets = raw.streets === undefined ? null : Streets.safeParse(raw.streets);
  const audio = AudioManifest.safeParse(raw.audio ?? { files: {} });
  if (!walking.success) report.errors.push(...zodIssues(`${dir}/walking.json`, walking.error));
  if (streets && !streets.success) report.errors.push(...zodIssues(`${dir}/streets.json`, streets.error));
  if (!audio.success) report.errors.push(...zodIssues(`public/audio/${raw.folder}/manifest.json`, audio.error));
  if (!city.success) report.errors.push(...zodIssues(`${dir}/city.json`, city.error));
  if (!places.success) report.errors.push(...zodIssues(`${dir}/places.json`, places.error));
  if (!routes.success) report.errors.push(...zodIssues(`${dir}/routes.json`, routes.error));
  if (lexicon && !lexicon.success) report.errors.push(...zodIssues(`${dir}/lexicon.json`, lexicon.error));
  if (
    !city.success ||
    !places.success ||
    !routes.success ||
    (lexicon && !lexicon.success) ||
    !walking.success ||
    (streets && !streets.success) ||
    !audio.success
  ) {
    return { bundle: null, lexicon: null, report };
  }

  const c: CityT = city.data;
  if (c.id !== raw.folder) report.errors.push(`${dir}/city.json: id «${c.id}» не совпадает с именем папки`);
  for (const t of c.editorial.todo) report.todo.push(`${c.name}: ${t}`);

  // Объекты
  const byId = new Map<string, PlaceT>();
  for (const p of places.data.places) {
    const where = `${dir}/places.json: ${p.id}`;
    if (byId.has(p.id)) report.errors.push(`${where} — повторяется id`);
    byId.set(p.id, p);
    if (!inBBox(p.location, c.bbox)) report.errors.push(`${where} — координата вне района города (bbox)`);
    if (p.listen_at && !inBBox(p.listen_at, c.bbox)) report.errors.push(`${where} — listen_at вне района города`);
    for (const ph of [...p.photos, ...p.then_now.flatMap((t) => [t.then, t.now])]) {
      if (!/^https?:/.test(ph.src) && !raw.fileExists(ph.src)) report.errors.push(`${where} — нет файла фото ${ph.src}`);
    }
    if (p.status === 'published') {
      for (const gap of publishedGaps(p)) report.errors.push(`${where} — опубликован, но ${gap}`);
    } else if (p.status === 'review') {
      if (p.sources.length === 0) report.warnings.push(`${where} — нет источников`);
    }
    for (const t of p.editorial.todo) report.todo.push(`${c.name} · ${p.name}: ${t}`);
  }

  // Граф улиц: пути между остановками строятся по нему, как в «Маленьком караване».
  const graph = streets?.success ? new StreetGraph(streets.data) : null;
  if (!graph) report.todo.push(`${c.name}: нет графа улиц — запустите workflow «Streets»; длина маршрутов пока по прямой`);
  const via = new Map(walking.data.leg_via.map((v) => [`${v.from}>${v.to}`, v.via as Pt[]]));
  const legBetween = (a: PlaceT, b: PlaceT): LegData | null => {
    if (!graph) return null;
    const pa = a.listen_at ?? a.location;
    const pb = b.listen_at ?? b.location;
    const forward = via.get(`${a.id}>${b.id}`);
    const backward = via.get(`${b.id}>${a.id}`);
    const middle = forward ?? (backward ? [...backward].reverse() : []);
    const line = graph.routeVia([[pa.lat, pa.lon], ...middle, [pb.lat, pb.lon]]);
    if (!line) return null;
    return { meters: Math.round(lineLength(line)), points: line.map(([la, lo]) => [round6(la), round6(lo)]) };
  };

  // Маршруты
  const routeIds = new Set<string>();
  const routeData: RouteData[] = [];
  for (const r of routes.data.routes) {
    const where = `${dir}/routes.json: ${r.id}`;
    if (routeIds.has(r.id)) report.errors.push(`${where} — повторяется id`);
    routeIds.add(r.id);
    if (new Set(r.stops).size !== r.stops.length) report.errors.push(`${where} — объект повторяется в маршруте`);
    const stops: PlaceT[] = [];
    for (const s of r.stops) {
      const p = byId.get(s);
      if (!p) report.errors.push(`${where} — нет объекта «${s}»`);
      else if (!visible(p) && visible(r)) report.errors.push(`${where} — объект «${s}» в черновике, а маршрут показывается`);
      else stops.push(p);
    }
    if (!visible(r) || stops.length !== r.stops.length) continue;
    const legs: LegData[] = [];
    for (let i = 1; i < stops.length && graph; i++) {
      const leg = legBetween(stops[i - 1], stops[i]);
      if (!leg) {
        report.errors.push(`${where} — нет пути по улицам от «${stops[i - 1].id}» до «${stops[i].id}» (точка дальше 150 м от улиц)`);
        continue;
      }
      const straight = lineLength([
        [stops[i - 1].location.lat, stops[i - 1].location.lon],
        [stops[i].location.lat, stops[i].location.lon],
      ]);
      if (leg.meters > straight * 4 + 200) {
        report.warnings.push(`${where} — путь «${stops[i - 1].id}» → «${stops[i].id}» подозрительно длинный: ${leg.meters} м при ${Math.round(straight)} м по прямой`);
      }
      legs.push(leg);
    }
    const distance = graph
      ? legs.reduce((s, l) => s + l.meters, 0)
      : routeDistanceMeters(stops.map((p) => p.listen_at ?? p.location));
    routeData.push({
      ...r,
      distance_m: distance,
      legs,
      duration_min:
        r.duration_min ?? routeDurationMinutes(distance, stops.map((p) => p.story.join(' ').length)),
      duration_estimated: r.duration_min === undefined,
    });
  }

  // Словарь озвучки: запись, которой нет ни в одном тексте, скорее всего опечатка.
  if (lexicon?.success) {
    const allText = places.data.places.flatMap((p) => [p.name, p.summary, ...p.story, p.note ?? '']).join('\n');
    for (const e of lexicon.data.entries) {
      if (!allText.includes(e.text)) report.warnings.push(`${dir}/lexicon.json — «${e.text}» не встречается в текстах`);
    }
  }

  if (report.errors.length > 0) return { bundle: null, lexicon: null, report };

  // Озвучка: файл есть и записан с того же текста — иначе предупреждение.
  const audioFiles = audio.data.files;
  const publicPlaces: PlaceData[] = places.data.places.filter(visible).map(({ editorial: _e, ...rest }) => {
    const rec = audioFiles[rest.id];
    const file = `audio/${c.id}/${rest.id}.mp3`;
    if (!rec || !raw.publicExists?.(file)) {
      report.warnings.push(`${dir}: ${rest.id} — нет озвучки (workflow «Voice»)`);
      return rest;
    }
    if (rec.text_hash !== textHash(placeSpeech(rest))) {
      report.warnings.push(`${dir}: ${rest.id} — текст изменился после озвучки, нужно переозвучить (workflow «Voice»)`);
    }
    return { ...rest, audio: `${file}?v=${rec.text_hash}` };
  });
  const { editorial: _ce, ...publicCity } = c;
  return {
    bundle: {
      format: BUNDLE_FORMAT,
      city: publicCity,
      places: publicPlaces,
      routes: routeData,
      streets: graph && raw.streetsFile ? raw.streetsFile : null,
      map_style: raw.hasMap ? `map/${c.id}/style.json` : null,
      phrases: raw.phrases ?? {},
    },
    lexicon: lexicon?.success ? lexicon.data : null,
    report,
  };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Текст для синтеза речи: подставляет словарь (сначала длинные записи). */
export function applyLexicon(text: string, entries: { text: string; say: string }[]): string {
  const sorted = [...entries].sort((a, b) => b.text.length - a.text.length);
  let out = text;
  for (const e of sorted) out = out.split(e.text).join(e.say);
  return out;
}
