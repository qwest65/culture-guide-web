import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CityBundle, RouteData } from '../content/bundle';
import { loadCity, useAsync } from '../data';
import { formatDistance } from '../lib/format';
import type { Pt, Turn } from '../lib/streets';
import { href } from '../router';
import { LoadError, Loading, NotFound } from '../ui';
import { browserLink, compassNeedsTap, inAppBrowser, isIOS, keepAwake, requestCompass, standalone } from '../walk/device';
import type { StopMark, WalkMap } from '../walk/map';
import { player } from '../walk/player';
import { WalkSession, type WalkView } from '../walk/session';
import { geoMessage } from '../walk/tracker';

const TURN_WORD: Record<Turn, string> = {
  left: 'поверните налево',
  right: 'поверните направо',
  slight_left: 'держитесь левее',
  slight_right: 'держитесь правее',
  u_turn: 'развернитесь',
};
const TURN_ICON: Record<Turn, string> = { left: '↰', right: '↱', slight_left: '↖', slight_right: '↗', u_turn: '↶' };

export function WalkScreen({ city: cityId, id }: { city: string; id: string }) {
  const [data, retry] = useAsync(() => loadCity(cityId), [cityId]);
  if (data.state === 'loading') return <Loading />;
  if (data.state === 'error') return <LoadError retry={retry} />;
  const route = data.value?.routes.find((r) => r.id === id);
  if (!data.value || !route) return <NotFound />;
  return <Walk bundle={data.value} route={route} />;
}

function usePlayer() {
  const [, set] = useState(0);
  useEffect(() => player.subscribe(() => set((n) => n + 1)), []);
  return player.current;
}

function Walk({ bundle, route }: { bundle: CityBundle; route: RouteData }) {
  const session = useMemo(() => new WalkSession(bundle, route), [bundle, route]);
  const [view, setView] = useState<WalkView>(session.view);
  const [following, setFollowing] = useState(true);
  const [compassAsked, setCompassAsked] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<WalkMap | null>(null);
  const playing = usePlayer();
  const city = bundle.city;

  useEffect(() => {
    const off = session.subscribe(() => setView(session.view));
    session.loadStreets();
    return () => {
      off();
      session.dispose();
      keepAwake(false);
    };
  }, [session]);

  // Карта грузится отдельным модулем.
  useEffect(() => {
    let cancelled = false;
    import('../walk/map').then(async ({ WalkMap, loadStyle }) => {
      const style = bundle.map_style ? await loadStyle(bundle.map_style) : null;
      if (cancelled || !mapEl.current) return;
      const first = session.stops[0].location;
      const m = new WalkMap(mapEl.current, style, [first.lat, first.lon]);
      m.onFollowChange = setFollowing;
      m.setRoute(session.legs.length ? session.legs : [session.stops.map((s) => [s.location.lat, s.location.lon] as Pt)]);
      mapRef.current = m;
      fitAll();
      drawStops(session.view);
    });
    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const allPoints = (): Pt[] => [
    ...session.legs.flat(),
    ...session.stops.map((s) => [s.location.lat, s.location.lon] as Pt),
  ];
  const fitAll = () => mapRef.current?.fit(allPoints(), Math.round(innerHeight * 0.38));

  const drawStops = (v: WalkView) =>
    mapRef.current?.setStops(
      session.stops.map(
        (s, i): StopMark => ({
          pt: [s.location.lat, s.location.lon],
          label: String(i + 1),
          title: s.name,
          state: v.done[i] ? 'done' : i === v.active ? 'target' : 'todo',
        }),
      ),
      (i) => session.openStop(i),
    );

  useEffect(() => drawStops(view), [view.active, view.done]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    m.setAhead(view.arrived === null ? view.ahead : null);
    if (view.me) {
      m.setMe(view.me, view.heading === null ? null : view.heading);
      m.followCamera(view.mapBearing);
    }
  }, [view.me, view.ahead, view.heading, view.mapBearing, view.arrived]);

  const start = async () => {
    session.start();
    keepAwake(true);
    mapRef.current?.follow();
  };

  const enableCompass = async () => {
    setCompassAsked(true);
    if (await requestCompass()) session.startCompass();
  };

  const target = view.active < session.stops.length ? session.stops[view.active] : null;
  const arrived = view.arrived !== null ? session.stops[view.arrived] : null;
  const t = session.tracker;
  const noGeo = view.started && !view.me;
  const showBrowserHelp = noGeo && !standalone && (t.failing || inAppBrowser);

  return (
    <div class="walk">
      <div class="walk-map" role="region" aria-label="Карта маршрута">
        <div class="walk-map-canvas" ref={mapEl} />
      </div>

      <header class="walk-top">
        <a class="walk-close" href={href.route(city.id, route.id)} aria-label="Закрыть прогулку">
          ✕
        </a>
        <div class="walk-banner" aria-live="polite">
          {!view.started ? (
            <span>{route.title}</span>
          ) : view.finished && view.arrived === null ? (
            <span>Маршрут пройден</span>
          ) : arrived ? (
            <span>Вы на месте</span>
          ) : noGeo ? (
            <span class="walk-banner-sub">{geoMessage(t)}</span>
          ) : view.instruction?.turn ? (
            <span>
              <b class="turn-icon" aria-hidden="true">
                {TURN_ICON[view.instruction.turn]}
              </b>{' '}
              {view.instruction.inMeters < 8 ? 'Сейчас' : `Через ${formatDistance(view.instruction.inMeters)}`} —{' '}
              {TURN_WORD[view.instruction.turn]}
            </span>
          ) : view.distanceM !== null ? (
            <span>
              {view.ahead?.straight ? 'По прямой' : 'Прямо'} {formatDistance(view.distanceM)}
            </span>
          ) : null}
        </div>
      </header>

      {showBrowserHelp && (
        <div class="walk-help" role="alert">
          Здесь браузер не сообщает, где вы. Откройте прогулку в {isIOS ? 'Safari' : 'браузере'}.
          <a class="button button-primary" href={browserLink()}>
            Открыть в {isIOS ? 'Safari' : 'браузере'}
          </a>
          <small>Не открылось? В меню ⋯ мессенджера выберите «Открыть в {isIOS ? 'Safari' : 'браузере'}».</small>
        </div>
      )}

      <div class="walk-tools">
        {!following && (
          <button type="button" class="map-btn" onClick={() => mapRef.current?.follow()} aria-label="Ко мне">
            ◎
          </button>
        )}
        <button type="button" class="map-btn" onClick={fitAll} aria-label="Весь маршрут">
          ⤢
        </button>
        <button type="button" class="map-btn" onClick={() => mapRef.current?.north()} aria-label="Север вверху">
          N
        </button>
        {view.started && compassNeedsTap && !view.compassOn && !compassAsked && (
          <button type="button" class="map-btn" onClick={enableCompass} aria-label="Включить компас">
            🧭
          </button>
        )}
      </div>

      <section class="walk-sheet" aria-label="Прогулка">
        {!view.started ? (
          <div class="sheet-body">
            <p class="eyebrow">Маршрут · {session.stops.length} остановок</p>
            <h1 class="sheet-title">{route.title}</h1>
            <p class="note">
              Гид поведёт по улицам и расскажет о каждом месте, когда вы подойдёте. Телефон спросит про геопозицию —
              нажмите «Разрешить». Наденьте наушники или включите звук.
            </p>
            <button type="button" class="button button-primary" onClick={start}>
              {view.active > 0 && !view.finished ? `Продолжить с точки ${view.active + 1}` : 'Начать прогулку'}
            </button>
            {view.active > 0 && (
              <button type="button" class="link-button" onClick={() => session.restart()}>
                Начать сначала
              </button>
            )}
          </div>
        ) : arrived ? (
          <div class="sheet-body">
            <p class="eyebrow">
              Точка {view.arrived! + 1} из {session.stops.length}
            </p>
            <h2 class="sheet-title">{arrived.name}</h2>
            {arrived.audio ? (
              <button
                type="button"
                class="button"
                onClick={() => (playing ? player.stop() : session.playStory(view.arrived!))}
              >
                {playing ? '⏸ Остановить рассказ' : '▶ Слушать рассказ'}
              </button>
            ) : (
              <p class="note">Аудиорассказ готовится — пока прочитайте текст.</p>
            )}
            <div class="sheet-story">
              {arrived.story.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
              <a href={href.place(city.id, arrived.id)}>Карточка объекта: даты, люди, источники</a>
            </div>
            <button type="button" class="button button-primary" onClick={() => session.continueWalk()}>
              {view.finished ? 'Завершить' : 'Идём дальше'}
            </button>
          </div>
        ) : view.finished ? (
          <div class="sheet-body">
            <h2 class="sheet-title">Маршрут пройден</h2>
            <p class="note">Спасибо, что гуляли с нами.</p>
            <a class="button button-primary" href={href.city(city.id)}>
              Другие маршруты
            </a>
            <button type="button" class="link-button" onClick={() => session.restart()}>
              Пройти ещё раз
            </button>
          </div>
        ) : target ? (
          <div class="sheet-body">
            <p class="eyebrow">
              Точка {view.active + 1} из {session.stops.length}
              {view.distanceM !== null && ` · ${formatDistance(view.distanceM)}`}
            </p>
            <h2 class="sheet-title">{target.name}</h2>
            <p class="note">{target.summary}</p>
            <div class="sheet-actions">
              <button type="button" class="button button-primary" onClick={() => session.arriveHere()}>
                Я на месте
              </button>
              <button type="button" class="button" onClick={() => session.skip()}>
                Пропустить
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
