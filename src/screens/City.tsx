import type { RouteData } from '../content/bundle';
import { loadCities, loadCity, useAsync } from '../data';
import { Guide } from './Guide';
import { countOf, formatDistance, formatDuration } from '../lib/format';
import { LoadError, Loading, NotFound, TopBar } from '../ui';

export function routeMeta(r: RouteData): string {
  const time = `${r.duration_estimated ? '≈ ' : ''}${formatDuration(r.duration_min)}`;
  return `${time} · ${formatDistance(r.distance_m)} · ${countOf(r.stops.length, 'остановка', 'остановки', 'остановок')}`;
}

export function CityScreen({ id }: { id: string }) {
  const [state, retry] = useAsync(async () => ({ data: await loadCity(id), cities: await loadCities() }), [id]);
  if (state.state === 'ready' && !state.value.data) return <NotFound />;
  if (state.state === 'ready' && state.value.data) return <Guide data={state.value.data} cities={state.value.cities} />;
  return (
    <>
      <TopBar />
      <main id="main" class="page">
        {state.state === 'error' ? <LoadError retry={retry} /> : <Loading />}
      </main>
    </>
  );
}
