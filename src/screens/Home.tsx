import { useState } from 'preact/hooks';
import type { CityIndexEntry } from '../content/bundle';
import { loadCities, useAsync } from '../data';
import { countOf, formatDistance } from '../lib/format';
import { detectCity, distanceMeters } from '../lib/geo';
import { href } from '../router';
import { load } from '../storage';
import { LoadError, Loading, PageTitle, TopBar } from '../ui';

type Geo =
  | { state: 'idle' }
  | { state: 'asking' }
  | { state: 'none'; nearest: CityIndexEntry | null; distance: number | null }
  | { state: 'failed'; reason: string };

/** Почему геопозиция не пришла — человеческими словами. */
function geoReason(err: GeolocationPositionError | null): string {
  if (!err) return 'Этот браузер не умеет определять геопозицию.';
  if (err.code === err.PERMISSION_DENIED)
    return 'Доступ к геопозиции запрещён. Во встроенном браузере мессенджера откройте страницу в Safari или Chrome либо выберите город из списка.';
  if (err.code === err.TIMEOUT) return 'Телефон слишком долго определял место. Выберите город из списка.';
  return 'Не удалось определить место. Выберите город из списка.';
}

export function Home() {
  const [cities, retry] = useAsync(loadCities, []);
  const [geo, setGeo] = useState<Geo>({ state: 'idle' });
  const last = load('lastCity');

  // Геопозицию спрашиваем только по нажатию: так требует iPhone, и так понятнее человеку.
  const locate = (list: CityIndexEntry[]) => {
    if (!('geolocation' in navigator)) return setGeo({ state: 'failed', reason: geoReason(null) });
    setGeo({ state: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const city = detectCity(list, here);
        if (city) {
          location.hash = href.city(city.id);
          return;
        }
        let nearest: CityIndexEntry | null = null;
        let distance: number | null = null;
        for (const c of list) {
          const d = distanceMeters(here, c.center);
          if (distance === null || d < distance) [nearest, distance] = [c, d];
        }
        setGeo({ state: 'none', nearest, distance });
      },
      (err) => setGeo({ state: 'failed', reason: geoReason(err) }),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };

  return (
    <>
      <TopBar />
      <main id="main" class="page">
        <PageTitle>Путеводитель по историческим городам России</PageTitle>
        <p class="lead">
          Достопримечательности, их история и пешеходные маршруты по старым улицам. Откройте на телефоне — и
          идите: гид проведёт по маршруту и расскажет о каждом месте, когда вы к нему подойдёте.
        </p>

        <ul class="features" role="list">
          <li>
            <b>Достопримечательности</b>
            <span>История, даты, архитекторы и источники по каждому месту</span>
          </li>
          <li>
            <b>Маршруты</b>
            <span>Тематические прогулки по улицам, с навигатором и временем в пути</span>
          </li>
          <li>
            <b>Рассказ на месте</b>
            <span>Подошли к объекту — гид рассказывает о нём голосом</span>
          </li>
        </ul>

        {cities.state === 'loading' && <Loading />}
        {cities.state === 'error' && <LoadError retry={retry} />}
        {cities.state === 'ready' && (
          <>
            <h2 class="section-title">Города</h2>
            <ul class="cards" role="list">
              {[...cities.value.cities]
                .sort((a, b) => Number(b.id === last) - Number(a.id === last))
                .map((c) => (
                  <li key={c.id}>
                    <a class="card city-card" href={href.city(c.id)}>
                      <span class="card-sub">{c.region}</span>
                      <span class="card-title city-title">{c.name}</span>
                      <span class="card-text">{c.intro}</span>
                      {c.highlights.length > 0 && (
                        <span class="highlights">
                          {c.highlights.map((h) => (
                            <span key={h} class="chip">
                              {h}
                            </span>
                          ))}
                        </span>
                      )}
                      <span class="card-meta">
                        {countOf(c.places, 'достопримечательность', 'достопримечательности', 'достопримечательностей')} ·{' '}
                        {countOf(c.routes, 'маршрут', 'маршрута', 'маршрутов')}
                      </span>
                      <span class="city-open">Открыть путеводитель →</span>
                    </a>
                  </li>
                ))}
            </ul>

            <div class="geo">
              <button
                type="button"
                class="link-button geo-button"
                onClick={() => locate(cities.value.cities)}
                disabled={geo.state === 'asking'}
              >
                {geo.state === 'asking' ? 'Определяем…' : 'Определить мой город по геопозиции'}
              </button>
              <div aria-live="polite">
                {geo.state === 'failed' && <p class="note">{geo.reason}</p>}
                {geo.state === 'none' && (
                  <p class="note">
                    Рядом с вами наших городов пока нет
                    {geo.nearest && geo.distance !== null && (
                      <>
                        {' '}
                        — ближайший {geo.nearest.name}, {formatDistance(geo.distance)}
                      </>
                    )}
                    .
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
