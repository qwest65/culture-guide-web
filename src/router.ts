import { useEffect, useState } from 'preact/hooks';

/**
 * Адреса экранов — во фрагменте (#/…): работают на любом хостинге без настройки сервера
 * и не теряются при открытии из QR-кода или мессенджера.
 *   #/                       выбор города
 *   #/troitsk                город
 *   #/troitsk/route/<id>     маршрут
 *   #/troitsk/route/<id>/walk  прогулка по маршруту: карта и навигатор
 *   #/troitsk/place/<id>     объект
 */
export type Route =
  | { name: 'home' }
  | { name: 'city'; city: string }
  | { name: 'route'; city: string; id: string }
  | { name: 'walk'; city: string; id: string }
  | { name: 'place'; city: string; id: string }
  | { name: 'not-found' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: 'home' };
  const [city, kind, id] = parts;
  if (parts.length === 1) return { name: 'city', city };
  if (parts.length === 3 && kind === 'route') return { name: 'route', city, id };
  if (parts.length === 3 && kind === 'place') return { name: 'place', city, id };
  if (parts.length === 4 && kind === 'route' && parts[3] === 'walk') return { name: 'walk', city, id };
  return { name: 'not-found' };
}

export const href = {
  home: () => '#/',
  city: (city: string) => `#/${city}`,
  route: (city: string, id: string) => `#/${city}/route/${id}`,
  place: (city: string, id: string) => `#/${city}/place/${id}`,
  walk: (city: string, id: string) => `#/${city}/route/${id}/walk`,
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
