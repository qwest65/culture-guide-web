import { useEffect } from 'preact/hooks';
import type { CityBundle, RouteData } from '../content/bundle';
import { loadCity, useAsync } from '../data';
import { countOf, formatDistance, formatDuration } from '../lib/format';
import { CATEGORY } from '../labels';
import { href } from '../router';
import { save } from '../storage';
import { LoadError, Loading, NotFound, PageTitle, TopBar } from '../ui';

export function routeMeta(r: RouteData): string {
  const time = `${r.duration_estimated ? '≈ ' : ''}${formatDuration(r.duration_min)}`;
  return `${time} · ${formatDistance(r.distance_m)} · ${countOf(r.stops.length, 'остановка', 'остановки', 'остановок')}`;
}

export function CityScreen({ id }: { id: string }) {
  const [city, retry] = useAsync(() => loadCity(id), [id]);
  useEffect(() => {
    if (city.state === 'ready' && city.value) save('lastCity', id);
  }, [city, id]);

  if (city.state === 'ready' && !city.value) return <NotFound />;
  return (
    <>
      <TopBar back={{ href: href.home(), label: 'Города' }} />
      <main id="main" class="page">
        {city.state === 'loading' && <Loading />}
        {city.state === 'error' && <LoadError retry={retry} />}
        {city.state === 'ready' && city.value && <CityBody data={city.value} />}
      </main>
    </>
  );
}

function CityBody({ data }: { data: CityBundle }) {
  const { city, routes, places } = data;
  const sorted = [...places].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return (
    <>
      <PageTitle eyebrow={city.region}>{city.name}</PageTitle>
      <p class="lead">{city.intro}</p>

      <h2 class="section-title">Маршруты</h2>
      <ul class="cards" role="list">
        {routes.map((r) => (
          <li key={r.id}>
            <a class="card" href={href.route(city.id, r.id)}>
              <span class="card-title">{r.title}</span>
              <span class="card-meta">{routeMeta(r)}</span>
              <span class="card-text">{r.description}</span>
            </a>
          </li>
        ))}
      </ul>

      <h2 class="section-title">Все объекты</h2>
      <ul class="list" role="list">
        {sorted.map((p) => (
          <li key={p.id}>
            <a class="list-item" href={href.place(city.id, p.id)}>
              <span class="list-title">{p.name}</span>
              <span class="list-sub">
                {CATEGORY[p.category]} · {p.address}
              </span>
            </a>
          </li>
        ))}
      </ul>

      {city.credits.length > 0 && (
        <footer class="credits">
          {city.credits.map((c) => (
            <p key={c.role}>
              {c.role}: {c.name}
            </p>
          ))}
        </footer>
      )}
    </>
  );
}
