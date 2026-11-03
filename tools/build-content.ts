/**
 * Проверяет пакеты городов из content/ и собирает их в public/data/ для приложения.
 *
 *   npm run content          — проверить и собрать
 *   npm run content:check    — только проверить (так запускается в CI)
 *
 * Ошибки (неверный формат, битые ссылки, опубликовано без источников) останавливают сборку.
 * Предупреждения и редакционные пункты печатаются отчётом и сборку не останавливают.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CitiesIndex } from '../src/content/schema';
import { BUNDLE_FORMAT, type CitiesIndexData, type CityIndexEntry } from '../src/content/bundle';
import { buildCity } from './content';
import { countOf } from '../src/lib/format';

const ROOT = resolve(import.meta.dirname, '..');
const CONTENT = join(ROOT, 'content');
const OUT = join(ROOT, 'public', 'data');
const checkOnly = process.argv.includes('--check');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const errors: string[] = [];
const warnings: string[] = [];
const todo: string[] = [];
const entries: CityIndexEntry[] = [];
const outputs: { name: string; body: string }[] = [];

const index = CitiesIndex.safeParse(readJson(join(CONTENT, 'cities.json')));
if (!index.success) {
  console.error('content/cities.json:', index.error.issues.map((i) => i.message).join('; '));
  process.exit(1);
}

const folders = readdirSync(join(CONTENT, 'cities'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
for (const f of folders) {
  if (!index.data.cities.includes(f)) warnings.push(`content/cities/${f} — папка есть, но города нет в content/cities.json`);
}

for (const id of index.data.cities) {
  const dir = join(CONTENT, 'cities', id);
  if (!existsSync(dir)) {
    errors.push(`content/cities.json: город «${id}» указан, но папки content/cities/${id} нет`);
    continue;
  }
  const lexiconPath = join(dir, 'lexicon.json');
  const { bundle, report } = buildCity({
    folder: id,
    city: readJson(join(dir, 'city.json')),
    places: readJson(join(dir, 'places.json')),
    routes: readJson(join(dir, 'routes.json')),
    lexicon: existsSync(lexiconPath) ? readJson(lexiconPath) : undefined,
    fileExists: (rel) => existsSync(join(dir, rel)),
  });
  errors.push(...report.errors);
  warnings.push(...report.warnings);
  todo.push(...report.todo);
  if (!bundle || bundle.city.status === 'draft') continue;

  const body = JSON.stringify(bundle);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
  const name = `${id}.${hash}.json`;
  outputs.push({ name, body });
  entries.push({
    id,
    name: bundle.city.name,
    name_prepositional: bundle.city.name_prepositional,
    region: bundle.city.region,
    center: bundle.city.center,
    bbox: bundle.city.bbox,
    places: bundle.places.length,
    routes: bundle.routes.length,
    bundle: name,
  });
}

const section = (title: string, lines: string[]) => {
  if (lines.length === 0) return;
  console.log(`\n${title} (${lines.length}):`);
  for (const l of lines) console.log(`  • ${l}`);
};
section('Редакционные пункты', todo);
section('Предупреждения', warnings);
section('ОШИБКИ', errors);

if (errors.length > 0) {
  console.error(`\nПакеты городов не прошли проверку: ${errors.length} ошибок.`);
  process.exit(1);
}

const summary = entries.map((e) => `${e.name}: ${countOf(e.places, 'объект', 'объекта', 'объектов')}, ${countOf(e.routes, 'маршрут', 'маршрута', 'маршрутов')}`).join('; ');
if (checkOnly) {
  console.log(`\nПроверка пройдена. ${summary}`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const o of outputs) writeFileSync(join(OUT, o.name), o.body);
  const indexData: CitiesIndexData = { format: BUNDLE_FORMAT, cities: entries };
  writeFileSync(join(OUT, 'cities.json'), JSON.stringify(indexData));
  console.log(`\nСобрано в public/data/. ${summary}`);
}
