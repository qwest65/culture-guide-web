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
import { isWinter } from '../lib/season';
import { loadOldStandard } from '../postcard/fonts';

const base = import.meta.env.BASE_URL;
const photoOf = (p: PlaceData | undefined) => (p?.photos[0] ? base + p.photos[0].src : null);
/** Фон-фото с учётом того, какую часть кадра держать в центре. */
const photoStyle = (p: PlaceData | undefined) =>
  p?.photos[0] ? { backgroundImage: `url("${base + p.photos[0].src}")`, backgroundPosition: p.photos[0].focus ?? 'center' } : undefined;

export function routeTime(r: RouteData): string {
  return `${r.duration_estimated ? '≈ ' : ''}${formatDuration(r.duration_min)}`;
}

export function Guide({ data, cities }: { data: CityBundle; cities?: CitiesIndexData }) {
  const winter = isWinter();
  const { city, places } = data;
  // сезонные маршруты — только в свой сезон, и тогда первыми
  const routes = data.routes.filter((r) => !r.season || (r.season === 'winter' && winter));
  const byId = new Map(places.map((p) => [p.id, p]));
  const cover = byId.get(city.cover ?? '') ?? places.find((p) => p.photos.length);
  const featured =
    (winter && routes.find((r) => r.season === 'winter')) || routes.find((r) => r.id === city.featured_route) || routes[0];
  const heroRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    loadOldStandard(); // шрифт с ятями — для карточки открытки
  }, []);

  useEffect(() => {
    save('lastCity', city.id);
    heroRef.current?.focus({ preventScroll: true });
  }, [city.id]);

  const coverPhoto = photoOf(cover);
  const coverThen = cover?.then_now[0]?.then;
  const withPast = places.filter((p) => p.then_now.length && p.photos.length);
  const postcardSrc = withPast.find((p) => p.id === city.postcard_view)?.then_now[0].then.src ?? withPast[0]?.then_now[0].then.src;
  const postcardCard = postcardSrc && (
    <a class="winter-card" href={href.card(city.id)}>
      <span class="winter-card-img" style={{ backgroundImage: `url("${base + postcardSrc}")` }}>
        <span class="winter-card-greet">{winter ? 'Съ Новымъ годомъ!' : `Привѣтъ изъ ${city.name_genitive ?? city.name}!`}</span>
      </span>
      <span class="winter-card-body">
        <b>{winter ? 'Новогодняя открытка' : 'Открытка'} из {city.name_genitive ?? city.name}</b>
        <span>Старинный вид родного города и пара тёплых слов — маме, друзьям, тем, кто уехал далеко.</span>
        <span class="city-open">Сделать открытку →</span>
      </span>
    </a>
  );

  return (
    <>
      <TopBar />
      <main id="main" class="guide">
        <section
          class={`hero${coverPhoto ? ' hero-photo' : ''}`}
          style={photoStyle(cover)}
        >
          {winter && <Snow />}
          {coverThen && (
            <div class="hero-then" style={{ backgroundImage: `url("${base + coverThen.src}")` }} aria-hidden="true" />
          )}
          {coverThen && (
            <span class="hero-era" aria-hidden="true">
              <span class="era-now">Сейчас</span>
              <span class="era-then">{coverThen.year ?? 'Было'}</span>
            </span>
          )}
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
            {winter ? (
              <div class="hero-actions">
                <a class="button button-hero button-winter" href={href.card(city.id)}>
                  ✉ Новогодняя открытка
                </a>
                {featured && (
                  <button type="button" class="hero-secondary" onClick={() => startWalk(city.id, featured.id)}>
                    ▶ или пройтись: «{featured.title}» · {routeTime(featured)}
                  </button>
                )}
              </div>
            ) : (
              featured && (
                <div class="hero-actions">
                  <button type="button" class="button button-hero" onClick={() => startWalk(city.id, featured.id)}>
                    ▶ Начать прогулку
                  </button>
                  <span class="hero-hint">
                    «{featured.title}» · {routeTime(featured)} · {formatDistance(featured.distance_m)}
                  </span>
                </div>
              )
            )}
          </div>
          {cover?.photos[0] && (
            <p class="hero-credit">
              {cover.name}. Фото: {cover.photos[0].author}, {cover.photos[0].license}
              {coverThen && `; ${coverThen.caption}, ${coverThen.license}`}
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

          {winter && postcardCard}

          {withPast.length > 0 && (
            <>
              <h2 class="section-title">Окно в прошлое</h2>
              <p class="section-lead">Сравните, каким город был сто лет назад. У места — наведите камеру и снимите своё «было/стало».</p>
              <ul class="past-cards" role="list">
                {withPast.map((p, i) => {
                  const then = p.then_now[0].then;
                  return (
                    <li key={p.id}>
                      <a class="past-card" href={href.place(city.id, p.id)}>
                        <span class="past-img">
                          <img src={base + p.photos[0].src} alt="" loading="lazy" style={{ objectPosition: p.photos[0].focus ?? 'center' }} />
                          <img class="past-then" src={base + then.src} alt="" loading="lazy" style={{ animationDelay: `${(i % 4) * -1.6}s` }} />
                          <span class="past-year">{then.year ?? 'Было'}</span>
                        </span>
                        <span class="past-name">{p.name}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {!winter && postcardCard}

          <h2 class="section-title" id="routes">
            Маршруты
          </h2>
          <ul class="route-cards" role="list">
            {routes.map((r) => {
              const withPhoto = r.stops.map((s) => byId.get(s)).find((p) => p?.photos.length);
              const photo = photoOf(withPhoto);
              return (
                <li key={r.id} class="route-card">
                  <a class="route-card-link" href={href.route(city.id, r.id)}>
                    <span
                      class={`route-card-img${photo ? '' : ' no-photo'}`}
                      style={photoStyle(withPhoto)}
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
                      style={photoStyle(p)}
                      aria-hidden="true"
                    >
                      {!photo && <span class="tile-letter">{p.name.replace(/^[«"]/, '')[0]}</span>}
                    </span>
                    {p.then_now.length > 0 && (
                      <span class="tile-badge">🕰 {p.then_now[0].then.year ?? 'было/стало'}</span>
                    )}
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

/** Снег на обложке: несколько десятков хлопьев, разные размеры, скорость и снос. */
function Snow() {
  const flakes = Array.from({ length: 46 }, (_, i) => {
    const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    const size = 3 + r(1) * 6;
    return (
      <span
        key={i}
        style={{
          left: `${r(2) * 100}%`,
          width: `${size}px`,
          height: `${size}px`,
          opacity: 0.5 + r(3) * 0.5,
          animationDuration: `${7 + r(4) * 9}s, ${3 + r(5) * 3}s`,
          animationDelay: `${-r(6) * 16}s, ${-r(7) * 6}s`,
        }}
      />
    );
  });
  return (
    <div class="snow" aria-hidden="true">
      {flakes}
    </div>
  );
}
