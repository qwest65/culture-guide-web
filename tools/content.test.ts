import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLexicon, buildCity, type RawCity } from './content';

const dir = resolve(import.meta.dirname, '../content/cities/troitsk');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const troitsk = (): RawCity => ({
  folder: 'troitsk',
  city: read('city.json'),
  places: read('places.json'),
  routes: read('routes.json'),
  lexicon: read('lexicon.json'),
  fileExists: () => false,
});

describe('buildCity', () => {
  it('Троицк собирается без ошибок', () => {
    const { bundle, report } = buildCity(troitsk());
    expect(report.errors).toEqual([]);
    expect(bundle!.places.length).toBe(14);
    expect(bundle!.routes.length).toBe(4);
    // редакционные пометки в приложение не попадают
    expect(JSON.stringify(bundle)).not.toContain('"editorial"');
    for (const r of bundle!.routes) {
      expect(r.distance_m).toBeGreaterThan(0);
      expect(r.duration_min % 5).toBe(0);
    }
  });

  it('маршрут со ссылкой на несуществующий объект — ошибка', () => {
    const raw = troitsk();
    (raw.routes as any).routes[0].stops.push('net-takogo');
    expect(buildCity(raw).report.errors.join('\n')).toContain('нет объекта «net-takogo»');
  });

  it('опубликованный объект без источников — ошибка', () => {
    const raw = troitsk();
    const p = (raw.places as any).places.find((x: any) => x.id === 'torgovye-ryady');
    p.status = 'published';
    const errors = buildCity(raw).report.errors.join('\n');
    expect(errors).toContain('torgovye-ryady — опубликован, но нет источников');
  });

  it('черновик не попадает в приложение, а маршрут через него — ошибка', () => {
    const raw = troitsk();
    (raw.places as any).places.find((x: any) => x.id === 'bronzovyy-verblyud').status = 'draft';
    const { bundle } = buildCity(raw);
    expect(bundle!.places.map((p) => p.id)).not.toContain('bronzovyy-verblyud');

    (raw.places as any).places.find((x: any) => x.id === 'svyato-troitskiy-sobor').status = 'draft';
    expect(buildCity(raw).report.errors.join('\n')).toContain('в черновике');
  });

  it('координата вне района города — ошибка', () => {
    const raw = troitsk();
    (raw.places as any).places[0].location = { lat: 55.75, lon: 37.62 };
    expect(buildCity(raw).report.errors.join('\n')).toContain('вне района города');
  });

  it('фото без автора и лицензии не принимается', () => {
    const raw = troitsk();
    (raw.places as any).places[0].photos = [{ src: 'photos/a.jpg', kind: 'archive', caption: 'Вид улицы' }];
    expect(buildCity(raw).report.errors.join('\n')).toMatch(/photos\.0\.author/);
  });
});

describe('applyLexicon', () => {
  it('подставляет длинные записи раньше коротких', () => {
    const entries = [
      { text: 'И. И. Неплюев', say: 'Иван Иванович Неплюев' },
      { text: 'И. И. Неплюевым', say: 'Иваном Ивановичем Неплюевым' },
    ];
    expect(applyLexicon('основанной И. И. Неплюевым в 1743', entries)).toBe('основанной Иваном Ивановичем Неплюевым в 1743');
    expect(applyLexicon('заложил И. И. Неплюев', entries)).toBe('заложил Иван Иванович Неплюев');
  });
});
