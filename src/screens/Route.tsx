import { loadCity, useAsync } from '../data';
import { CATEGORY } from '../labels';
import { href } from '../router';
import { LoadError, Loading, NotFound, PageTitle, TopBar } from '../ui';
import { routeMeta } from './City';
import { savedProgress } from '../walk/session';

export function RouteScreen({ city: cityId, id }: { city: string; id: string }) {
  const [data, retry] = useAsync(() => loadCity(cityId), [cityId]);
  if (data.state === 'loading' || data.state === 'error')
    return (
      <>
        <TopBar back={{ href: href.city(cityId), label: 'Город' }} />
        <main id="main" class="page">
          {data.state === 'loading' ? <Loading /> : <LoadError retry={retry} />}
        </main>
      </>
    );
  const route = data.value?.routes.find((r) => r.id === id);
  if (!data.value || !route) return <NotFound />;
  const places = new Map(data.value.places.map((p) => [p.id, p]));
  const progress = savedProgress(cityId, route.id);
  const resume = progress && progress.active > 0 && progress.active < route.stops.length;

  return (
    <>
      <TopBar back={{ href: href.city(cityId), label: data.value.city.name }} />
      <main id="main" class="page">
        <PageTitle eyebrow="Маршрут">{route.title}</PageTitle>
        <p class="meta">{routeMeta(route)}</p>
        <p class="lead">{route.description}</p>
        <a class="button button-primary" href={href.walk(cityId, route.id)}>
          {resume ? `Продолжить прогулку · точка ${progress!.active + 1}` : 'Начать прогулку'}
        </a>
        {route.duration_estimated && (
          <p class="note">Время — оценка с учётом рассказов на остановках; уточним после прохода маршрута.</p>
        )}

        <h2 class="section-title">Остановки</h2>
        <ol class="stops">
          {route.stops.map((s, i) => {
            const p = places.get(s)!;
            return (
              <li key={s}>
                <a class="stop" href={href.place(cityId, s)}>
                  <span class="stop-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span class="stop-body">
                    <span class="list-title">{p.name}</span>
                    <span class="list-sub">
                      {CATEGORY[p.category]} · {p.address}
                    </span>
                    <span class="card-text">{p.summary}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </main>
    </>
  );
}
