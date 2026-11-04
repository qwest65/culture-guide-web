/**
 * Путеводитель по городу — главная страница и страница города.
 * Всё на одном экране: обложка с кнопкой «Начать прогулку», маршруты с кнопкой «Начать»,
 * достопримечательности плиткой, карта всех мест. Меньше переходов — сразу в прогулку.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CitiesIndexData, CityBundle, PlaceData, RouteData } from '../content/bundle';
import { countOf, formatDistance, formatDuration } from '../lib/format';
import { CATEGORY } from '../labels';
import { href } from '../router';
import { save } from '../storage';
import { TopBar } from '../ui';
import type { Pt } from '../lib/streets';
import { startWalk } from '../walk/start';

const base = import.meta.env.BASE_URL;
const photoOf = (p: PlaceData | undefined) => (p?.photos[0] ? base + p.photos[0].src : null);

export function routeTime(r: RouteData): string {
  return `${r.duration_estimated ? '≈ ' : ''}${formatDuration(r.duration_min)}`;
}

export function Guide({ data, cities }: { data: CityBundle; cities?: CitiesIndexData }) {
  const { city, routes, places } = data;
  const byId = new Map(places.map((p) => [p.id, p]));
  const cover = byId.get(city.cover ?? '') ?? places.find((p) => p.photos.length);
  const featured = routes.find((r) => r.id === city.featured_route) ?? routes[0];
  const heroRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    save('lastCity', city.id);
    heroRef.current?.focus({ preventScroll: true });
  }, [city.id]);

  const coverPhoto = photoOf(cover);
  return (
    <>
      <TopBar />
      <main id="main" class="guide">
        <section
          class={`hero${coverPhoto ? ' hero-photo' : ''}`}
          style={coverPhoto ? { backgroundImage: `url("${coverPhoto}")` } : undefined}
        >
          <div class="hero-inner">
            {cities && cities.cities.length > 1 && (
              <nav class="city-switch" aria-label="Города">
                {cities.cities.map((c) => (
                  <a key={c.id} href={href.city(c.id)} aria-current={c.id === city.id ? 'page' : undefined}>
                    {c.name}
                  </a>
                ))}
              </nav>
            )}
            <p class="hero-region">{city.region}</p>
            <h1 ref={heroRef} tabIndex={-1} class="hero-title">
              {city.name}
            </h1>
            {city.tagline && <p class="hero-tagline">{city.tagline}</p>}
            {featured && (
              <div class="hero-actions">
                <button type="button" class="button button-hero" onClick={() => startWalk(city.id, featured.id)}>
                  ▶ Начать прогулку
                </button>
                <span class="hero-hint">
                  «{featured.title}» · {routeTime(featured)} · {formatDistance(featured.distance_m)}
                </span>
              </div>
            )}
          </div>
          {cover?.photos[0] && (
            <p class="hero-credit">
              {cover.name}. Фото: {cover.photos[0].author}, {cover.photos[0].license}
            </p>
          )}
        </section>

        <div class="guide-body">
          <p class="lead">{city.intro}</p>
          <ul class="facts-row" role="list">
            <li>
              <b>{places.length}</b> {countOf(places.length, 'место', 'места', 'мест').split(' ')[1]}
            </li>
            <li>
              <b>{routes.length}</b> {countOf(routes.length, 'маршрут', 'маршрута', 'маршрутов').split(' ')[1]}
            </li>
            <li>
              <b>{places.filter((p) => p.audio).length}</b> рассказов голосом
            </li>
          </ul>

          <h2 class="section-title" id="routes">
            Маршруты
          </h2>
          <ul class="route-cards" role="list">
            {routes.map((r) => {
              const photo = photoOf(r.stops.map((s) => byId.get(s)).find((p) => p?.photos.length));
              return (
                <li key={r.id} class="route-card">
                  <a class="route-card-link" href={href.route(city.id, r.id)}>
                    <span
                      class={`route-card-img${photo ? '' : ' no-photo'}`}
                      style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
                      aria-hidden="true"
                    />
                    <span class="route-card-body">
                      <span class="card-title">{r.title}</span>
                      <span class="card-meta">
                        {routeTime(r)} · {formatDistance(r.distance_m)} ·{' '}
                        {countOf(r.stops.length, 'место', 'места', 'мест')}
                      </span>
                      <span class="card-text clamp">{r.description}</span>
                    </span>
                  </a>
                  <button type="button" class="button button-primary route-start" onClick={() => startWalk(city.id, r.id)}>
                    ▶ Начать
                  </button>
                </li>
              );
            })}
          </ul>

          <h2 class="section-title">Достопримечательности</h2>
          <ul class="tiles" role="list">
            {places.map((p) => {
              const photo = photoOf(p);
              return (
                <li key={p.id}>
                  <a class="tile" href={href.place(city.id, p.id)}>
                    <span
                      class={`tile-img cat-${p.category}${photo ? '' : ' no-photo'}`}
                      style={photo ? { backgroundImage: `url("${photo}")` } : undefined}
                      aria-hidden="true"
                    >
                      {!photo && <span class="tile-letter">{p.name.replace(/^[«"]/, '')[0]}</span>}
                    </span>
                    <span class="tile-name">{p.name}</span>
                    <span class="tile-sub">{CATEGORY[p.category]}</span>
                  </a>
                </li>
              );
            })}
          </ul>

          <h2 class="section-title">На карте</h2>
          <PlacesMap data={data} />

          <footer class="credits">
            {city.credits.map((c) => (
              <p key={c.role}>
                {c.role}: {c.name}
              </p>
            ))}
            {places.some((p) => p.photos.length) && <p>Фото — команда проекта и Викисклад; авторы и лицензии указаны в карточках мест.</p>}
            <p>Голос — Яндекс SpeechKit.</p>
          </footer>
        </div>
      </main>
    </>
  );
}

/** Карта всех мест города: грузится, когда до неё долистали. */
function PlacesMap({ data }: { data: CityBundle }) {
  const el = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    if (!('IntersectionObserver' in window)) return setVisible(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '300px' });
    io.observe(el.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let destroy: (() => void) | null = null;
    let cancelled = false;
    import('../walk/map').then(async ({ WalkMap, loadStyle }) => {
      const style = data.map_style ? await loadStyle(data.map_style) : null;
      if (cancelled || !el.current) return;
      const c = data.city.center;
      const m = new WalkMap(el.current, style, [c.lat, c.lon]);
      const pts: Pt[] = data.places.map((p) => [p.location.lat, p.location.lon]);
      m.setStops(
        data.places.map((p, i) => ({ pt: pts[i], label: String(i + 1), title: p.name, state: 'todo' as const })),
        (i) => {
          location.hash = href.place(data.city.id, data.places[i].id);
        },
      );
      m.fit(pts, 40);
      destroy = () => m.destroy();
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [visible, data]);

  return (
    <div class="places-map-wrap">
      <div class="places-map" ref={el} role="region" aria-label={`Карта достопримечательностей: ${data.city.name}`} />
      <ol class="places-map-legend">
        {data.places.map((p) => (
          <li key={p.id}>
            <a href={href.place(data.city.id, p.id)}>{p.name}</a>
          </li>
        ))}
      </ol>
    </div>
  );
}
