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
import { AudioManifest, CitiesIndex, Voice } from '../src/content/schema';
import { BUNDLE_FORMAT, type CitiesIndexData, type CityIndexEntry } from '../src/content/bundle';
import { buildCity, textHash } from './content';
import { countOf } from '../src/lib/format';

const ROOT = resolve(import.meta.dirname, '..');
const CONTENT = join(ROOT, 'content');
const PUBLIC = join(ROOT, 'public');
const OUT = join(PUBLIC, 'data');
const hashOf = (body: string) => createHash('sha256').update(body).digest('hex').slice(0, 10);
const checkOnly = process.argv.includes('--check');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const errors: string[] = [];
const warnings: string[] = [];
const todo: string[] = [];
const entries: CityIndexEntry[] = [];
const outputs: { name: string; body: string }[] = [];

// Общие фразы навигатора: в приложение попадают только озвученные.
const voice = Voice.safeParse(readJson(join(CONTENT, 'voice.json')));
if (!voice.success) {
  console.error('content/voice.json:', voice.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  process.exit(1);
}
const commonAudio = existsSync(join(PUBLIC, 'audio/common/manifest.json'))
  ? AudioManifest.parse(readJson(join(PUBLIC, 'audio/common/manifest.json'))).files
  : {};
const phrases: Record<string, string> = {};
for (const [key, text] of Object.entries(voice.data.phrases)) {
  const rec = commonAudio[key];
  const file = `audio/common/${key}.mp3`;
  if (!rec || !existsSync(join(PUBLIC, file))) {
    warnings.push(`content/voice.json: фраза «${key}» не озвучена (workflow «Voice»)`);
    continue;
  }
  if (rec.text_hash !== textHash(text)) warnings.push(`content/voice.json: фраза «${key}» изменилась после озвучки`);
  phrases[key] = `${file}?v=${rec.text_hash}`;
}

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
  const optional = (path: string) => (existsSync(path) ? readJson(path) : undefined);
  const streetsPath = join(dir, 'streets.json');
  let streetsFile: string | undefined;
  if (existsSync(streetsPath)) {
    const body = JSON.stringify(readJson(streetsPath));
    streetsFile = `${id}.streets.${hashOf(body)}.json`;
    outputs.push({ name: streetsFile, body });
  }
  const { bundle, report } = buildCity({
    folder: id,
    city: readJson(join(dir, 'city.json')),
    places: readJson(join(dir, 'places.json')),
    routes: readJson(join(dir, 'routes.json')),
    lexicon: optional(join(dir, 'lexicon.json')),
    walking: optional(join(dir, 'walking.json')),
    streets: optional(streetsPath),
    audio: optional(join(PUBLIC, 'audio', id, 'manifest.json')),
    streetsFile: streetsFile && `data/${streetsFile}`,
    hasMap: existsSync(join(PUBLIC, 'map', id, 'style.json')),
    phrases,
    fileExists: (rel) => existsSync(join(dir, rel)),
    publicExists: (rel) => existsSync(join(PUBLIC, rel)),
  });
  errors.push(...report.errors);
  warnings.push(...report.warnings);
  todo.push(...report.todo);
  if (!bundle || bundle.city.status === 'draft') continue;

  const body = JSON.stringify(bundle);
  const name = `${id}.${hashOf(body)}.json`;
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
