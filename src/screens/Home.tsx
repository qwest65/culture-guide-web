import { loadCities, loadCity, useAsync } from '../data';
import { load } from '../storage';
import { LoadError, Loading, TopBar } from '../ui';
import { Guide } from './Guide';

/**
 * Главная — сразу путеводитель: город, который человек смотрел последним, иначе первый в списке.
 * Когда городов станет несколько, на обложке появится переключатель городов.
 */
export function Home() {
  const [state, retry] = useAsync(async () => {
    const cities = await loadCities();
    const last = load('lastCity');
    const id = cities.cities.find((c) => c.id === last)?.id ?? cities.cities[0]?.id;
    const data = id ? await loadCity(id) : null;
    return { cities, data };
  }, []);

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
