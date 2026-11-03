/**
 * Проверка и сборка пакета города — без чтения файлов, чтобы её можно было тестировать.
 * Файлы читает tools/build-content.ts.
 */
import { z } from 'zod';
import { City, Lexicon, PlacesFile, RoutesFile, type CityT, type PlaceT } from '../src/content/schema';
import { BUNDLE_FORMAT, type CityBundle, type PlaceData, type RouteData } from '../src/content/bundle';
import { inBBox } from '../src/lib/geo';
import { routeDistanceMeters, routeDurationMinutes } from '../src/lib/estimate';

export type RawCity = {
  folder: string;
  city: unknown;
  places: unknown;
  routes: unknown;
  lexicon?: unknown;
  /** Существует ли файл в папке города (для фото). */
  fileExists: (relPath: string) => boolean;
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
  if (!city.success) report.errors.push(...zodIssues(`${dir}/city.json`, city.error));
  if (!places.success) report.errors.push(...zodIssues(`${dir}/places.json`, places.error));
  if (!routes.success) report.errors.push(...zodIssues(`${dir}/routes.json`, routes.error));
  if (lexicon && !lexicon.success) report.errors.push(...zodIssues(`${dir}/lexicon.json`, lexicon.error));
  if (!city.success || !places.success || !routes.success || (lexicon && !lexicon.success)) {
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
    const distance = routeDistanceMeters(stops.map((p) => p.listen_at ?? p.location));
    routeData.push({
      ...r,
      distance_m: distance,
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

  const publicPlaces: PlaceData[] = places.data.places.filter(visible).map(({ editorial: _e, ...rest }) => rest);
  const { editorial: _ce, ...publicCity } = c;
  return {
    bundle: { format: BUNDLE_FORMAT, city: publicCity, places: publicPlaces, routes: routeData },
    lexicon: lexicon?.success ? lexicon.data : null,
    report,
  };
}

/** Текст для синтеза речи: подставляет словарь (сначала длинные записи). */
export function applyLexicon(text: string, entries: { text: string; say: string }[]): string {
  const sorted = [...entries].sort((a, b) => b.text.length - a.text.length);
  let out = text;
  for (const e of sorted) out = out.split(e.text).join(e.say);
  return out;
}
