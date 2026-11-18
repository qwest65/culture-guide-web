/**
 * «Новогодняя открытка из Троицка»: выбрать вид (старая открытка, сегодняшнее фото или своё),
 * поздравление, пожелание, кому и от кого — и отправить.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CityBundle } from '../content/bundle';
import { loadCity, useAsync } from '../data';
import { newYear } from '../lib/season';
import { href } from '../router';
import { LoadError, Loading, NotFound, PageTitle, TopBar } from '../ui';
import { drawPostcard } from '../postcard/draw';
import { loadOldStandard } from '../postcard/fonts';
import { shareCard } from '../thennow/card';

const base = import.meta.env.BASE_URL;
const SITE = 'culture-guide.mooo.com';

type View = { key: string; src: string; label: string; caption: string; archive: boolean; crop?: number };

/** «Из Троицка» — родительный падеж берётся из city.json (name_genitive). */
const fromCityOf = (genitive: string, old: boolean) => `${old ? 'Изъ' : 'Из'} ${genitive}`;

const GREETINGS = (year: number) => ({
  old: ['Съ Новымъ годомъ!', 'Съ Рождествомъ Христовымъ!', `Съ Новымъ ${year} годомъ!`, 'Съ праздникомъ!'],
  modern: ['С Новым годом!', 'С Рождеством!', `С Новым ${year} годом!`, 'С праздником!'],
});
const WISH = {
  old: 'Счастья, тепла и добрыхъ встрѣчъ въ новомъ году!',
  modern: 'Счастья, тепла и добрых встреч в новом году!',
};

export function PostcardScreen({ city: cityId }: { city: string }) {
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
  if (!data.value) return <NotFound />;
  return <Postcard data={data.value} />;
}

function Postcard({ data }: { data: CityBundle }) {
  const { city, places } = data;
  const fromCity = (_name: string, old: boolean) => fromCityOf(city.name_genitive ?? city.name, old);
  const year = newYear();
  const views = useMemo<View[]>(() => {
    const old = places
      .filter((p) => p.then_now.length)
      .map((p) => {
        const t = p.then_now[0].then;
        const pastvu = (t.source_url ?? '').includes('pastvu.com');
        return {
          key: `then-${p.id}`,
          src: base + t.src,
          label: t.year ?? 'было',
          caption: `${p.name}. ${t.year ? `Снимок ${t.year}` : 'Старый снимок'}${pastvu ? ' · pastvu.com' : ''}`,
          archive: true,
          crop: pastvu ? 0.035 : 0,
        };
      })
      // первой — открытка, заданная в city.json (postcard_view), дальше как есть
      .sort((a, b) => Number(b.key === `then-${city.postcard_view}`) - Number(a.key === `then-${city.postcard_view}`));
    const now = places
      .filter((p) => p.photos.length)
      .map((p) => ({ key: `now-${p.id}`, src: base + p.photos[0].src, label: 'сейчас', caption: p.name, archive: false }));
    return [...old, ...now];
  }, [places]);

  const [view, setView] = useState<View>(views[0]);
  const [own, setOwn] = useState<View | null>(null);
  const [oldSpelling, setOldSpelling] = useState(true);
  const greetings = GREETINGS(year)[oldSpelling ? 'old' : 'modern'];
  const [gIdx, setGIdx] = useState(0);
  const [wish, setWish] = useState(WISH.old);
  const [wishEdited, setWishEdited] = useState(false);
  const [to, setTo] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!wishEdited) setWish(oldSpelling ? WISH.old : WISH.modern);
  }, [oldSpelling, wishEdited]);

  const current = own ?? view;

  // Загрузить картинку выбранного вида, затем перерисовать
  useEffect(() => {
    let alive = true;
    const i = new Image();
    i.onload = () => {
      if (!alive) return;
      img.current = i;
      redraw();
    };
    i.src = current.src;
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.src]);

  const redraw = () => {
    if (!canvas.current || !img.current) return;
    drawPostcard(canvas.current, {
      photo: img.current,
      archive: current.archive,
      cropBottom: current.crop,
      caption: current.caption,
      greeting: greetings[gIdx],
      wish,
      to,
      from,
      fromCity: fromCity(city.name, oldSpelling),
      site: `Культурный гид · ${SITE}`,
    });
    setReady(true);
  };

  useEffect(() => {
    loadOldStandard().then(redraw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(redraw, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gIdx, wish, to, from, oldSpelling, current]);

  const pickOwn = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setOwn({ key: 'own', src: url, label: 'своё', caption: `${city.name}, зима ${year - 1} года`, archive: false });
  };

  const send = async () => {
    if (!canvas.current) return;
    setBusy(true);
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.current!.toBlob((b) => (b ? res(b) : rej(new Error('canvas'))), 'image/jpeg', 0.9),
      );
      await shareCard(blob, `${greetings[gIdx]} ${fromCity(city.name, false)}`, 'otkrytka.jpg');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar back={{ href: href.city(city.id), label: city.name }} />
      <main id="main" class="page postcard-page">
        <PageTitle eyebrow="Новогодняя открытка">{fromCity(city.name, false)} — с любовью</PageTitle>
        <p class="lead">Старинная открытка с видом родного города — для тех, кто рядом, и для тех, кто уехал далеко.</p>

        <div class={`pc-preview${ready ? ' ready' : ''}`}>
          <canvas ref={canvas} role="img" aria-label="Предпросмотр открытки" />
        </div>

        <div class="pc-send">
          <button type="button" class="button button-hero" onClick={send} disabled={busy || !ready}>
            {busy ? 'Готовим…' : '✉ Отправить открытку'}
          </button>
        </div>

        <h2 class="section-title">Вид</h2>
        <ul class="pc-views" role="list">
          <li>
            <label class="pc-view pc-own">
              <input type="file" accept="image/*" onChange={(e) => pickOwn((e.target as HTMLInputElement).files?.[0])} />
              <span class="pc-own-icon" aria-hidden="true">
                📷
              </span>
              <span class="pc-view-label">Своё фото</span>
            </label>
          </li>
          {own && (
            <li>
              <button type="button" class="pc-view" aria-pressed={true} onClick={() => setOwn(own)}>
                <img src={own.src} alt="" />
                <span class="pc-view-label">своё</span>
              </button>
            </li>
          )}
          {views.map((v) => (
            <li key={v.key}>
              <button
                type="button"
                class="pc-view"
                aria-pressed={!own && v.key === view.key}
                aria-label={v.caption}
                onClick={() => {
                  setOwn(null);
                  setView(v);
                }}
              >
                <img src={v.src} alt="" loading="lazy" class={v.archive ? 'sepia' : ''} />
                <span class="pc-view-label">{v.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <h2 class="section-title">Поздравление</h2>
        <div class="pc-chips" role="radiogroup" aria-label="Поздравление">
          {greetings.map((t, i) => (
            <button key={t} type="button" role="radio" aria-checked={i === gIdx} class="chip-btn" onClick={() => setGIdx(i)}>
              {t}
            </button>
          ))}
        </div>
        <label class="pc-toggle">
          <input type="checkbox" checked={oldSpelling} onChange={(e) => setOldSpelling((e.target as HTMLInputElement).checked)} />
          <span>Старинная орфография — с ятями и твёрдыми знаками, как в 1911 году</span>
        </label>

        <div class="pc-fields">
          <label>
            <span>Пожелание</span>
            <textarea
              rows={2}
              maxLength={90}
              value={wish}
              onInput={(e) => {
                setWish((e.target as HTMLTextAreaElement).value);
                setWishEdited(true);
              }}
            />
          </label>
          <label>
            <span>Кому</span>
            <input type="text" maxLength={40} placeholder="Дорогой маме" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
          </label>
          <label>
            <span>От кого</span>
            <input type="text" maxLength={40} placeholder="От любящей дочери" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
          </label>
        </div>

        <button type="button" class="button button-primary pc-send-bottom" onClick={send} disabled={busy || !ready}>
          {busy ? 'Готовим…' : '✉ Отправить открытку'}
        </button>
        <p class="note">
          Открытка собирается прямо в телефоне — ни фото, ни имена никуда не отправляются, пока вы сами не нажмёте
          «Отправить».
        </p>
      </main>
    </>
  );
}
