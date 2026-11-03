import { loadCity, useAsync } from '../data';
import { formatHistDate } from '../lib/format';
import { CATEGORY, HERITAGE, ROLE } from '../labels';
import { href } from '../router';
import { LoadError, Loading, NotFound, PageTitle, TopBar } from '../ui';
import { ListenButton } from '../walk/ListenButton';

export function PlaceScreen({ city: cityId, id }: { city: string; id: string }) {
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
  const place = data.value?.places.find((p) => p.id === id);
  if (!data.value || !place) return <NotFound />;
  const onRoutes = data.value.routes.filter((r) => r.stops.includes(place.id));

  return (
    <>
      <TopBar back={{ href: href.city(cityId), label: data.value.city.name }} />
      <main id="main" class="page">
        <PageTitle eyebrow={CATEGORY[place.category]}>{place.name}</PageTitle>
        <p class="meta">{place.address}</p>
        {place.heritage && <p class="badge">{HERITAGE[place.heritage.level]}</p>}

        {place.audio && <ListenButton url={place.audio} />}

        <article class="story">
          {place.story.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </article>

        {(place.dates.length > 0 || place.people.length > 0) && (
          <section aria-labelledby="facts">
            <h2 id="facts" class="section-title">
              Даты и люди
            </h2>
            <dl class="facts">
              {place.dates.map((d) => (
                <div key={d.date + d.event}>
                  <dt>{formatHistDate(d.date)}</dt>
                  <dd>{d.event}</dd>
                </div>
              ))}
              {place.people.map((p) => (
                <div key={p.name + p.role}>
                  <dt>{ROLE[p.role]}</dt>
                  <dd>
                    {p.name}
                    {p.years && ` (${p.years})`}
                    {p.attribution === 'probable' && ' — предположительно'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {onRoutes.length > 0 && (
          <section aria-labelledby="on-routes">
            <h2 id="on-routes" class="section-title">
              На маршрутах
            </h2>
            <ul class="list" role="list">
              {onRoutes.map((r) => (
                <li key={r.id}>
                  <a class="list-item" href={href.route(cityId, r.id)}>
                    <span class="list-title">{r.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="sources">
          <h2 id="sources" class="section-title">
            Источники
          </h2>
          {place.sources.length === 0 ? (
            <p class="note">Источники уточняются редакцией.</p>
          ) : (
            <ul class="sources">
              {place.sources.map((s) => (
                <li key={s.title}>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  {(s.publisher || s.year) && <span class="list-sub"> {[s.publisher, s.year].filter(Boolean).join(', ')}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
