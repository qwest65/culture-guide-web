import { useEffect, useState } from 'preact/hooks';
import type { CitiesIndexData, CityBundle } from './content/bundle';

const base = import.meta.env.BASE_URL;

// cities.json всегда перепроверяется у сервера; файлы городов с хэшем в имени
// неизменны и кэшируются надолго — телефон не застрянет на старой версии.
let citiesPromise: Promise<CitiesIndexData> | null = null;
const bundles = new Map<string, Promise<CityBundle>>();

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export function loadCities(): Promise<CitiesIndexData> {
  citiesPromise ??= getJson<CitiesIndexData>('data/cities.json', { cache: 'no-cache' }).catch((e) => {
    citiesPromise = null;
    throw e;
  });
  return citiesPromise;
}

export async function loadCity(id: string): Promise<CityBundle | null> {
  const index = await loadCities();
  const entry = index.cities.find((c) => c.id === id);
  if (!entry) return null;
  let p = bundles.get(entry.bundle);
  if (!p) {
    p = getJson<CityBundle>(`data/${entry.bundle}`);
    p.catch(() => bundles.delete(entry.bundle));
    bundles.set(entry.bundle, p);
  }
  return p;
}

export type Async<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error'; error: Error };

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): [Async<T>, () => void] {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setResult({ state: 'loading' });
    fn().then(
      (value) => alive && setResult({ state: 'ready', value }),
      (error: Error) => alive && setResult({ state: 'error', error }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return [result, () => setAttempt((a) => a + 1)];
}
