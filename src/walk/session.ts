/**
 * Ведение по маршруту: геопозиция → путь по улицам → прибытие → рассказ.
 * Без интерфейса: экран прогулки подписывается на изменения и рисует состояние.
 *
 * Логика — из «Маленького каравана»: путь к точке по улицам города (граф в телефоне),
 * перестроение, если свернули; повороты за 20 м; прибытие — 5 секунд в радиусе.
 */
import type { CityBundle, PlaceData, RouteData } from '../content/bundle';
import { arriveManually, DEFAULT_GUIDANCE, initialGuidance, updateGuidance, type GuidanceState, type Stop } from '../lib/guidance';
import { bearingDegrees, dist, StreetGraph, WalkPath, type Instruction, type Pt, type StreetsData } from '../lib/streets';
import { load, save } from '../storage';
import { listenCompass } from './device';
import { player } from './player';
import { Tracker, type TrackFix } from './tracker';

/** Ближе этого к линии пути — считаем, что идём по ней. */
const ON_PATH_M = 25;
/** Сколько отметок подряд в стороне от пути, прежде чем строить заново. */
const REROUTE_CONFIRM_FIXES = 2;
const REROUTE_INTERVAL_MS = 3000;
/** «Мы почти на месте». */
const NEAR_M = 70;
/** За сколько метров до поворота о нём говорить. */
const TURN_ANNOUNCE_M = 20;
/** Магнитное склонение по умолчанию (Южный Урал ≈ 13° к востоку). */
const DECLINATION = 13;
const COURSE_STEP_M = 8;

export type Ahead = { pts: Pt[]; straight: boolean } | null;

export type WalkView = {
  started: boolean;
  active: number;
  /** Остановка, у которой человек сейчас стоит (открыт рассказ), или null. */
  arrived: number | null;
  done: boolean[];
  finished: boolean;
  me: Pt | null;
  distanceM: number | null;
  instruction: Instruction | null;
  ahead: Ahead;
  heading: number | null;
  mapBearing: number | null;
  compassOn: boolean;
};

const storeKey = (city: string, route: string) => `walk.${city}.${route}`;

export function savedProgress(city: string, route: string): { active: number; done: boolean[] } | null {
  try {
    const raw = load(storeKey(city, route));
    return raw ? (JSON.parse(raw) as { active: number; done: boolean[] }) : null;
  } catch {
    return null;
  }
}

export class WalkSession {
  readonly stops: PlaceData[];
  readonly legs: Pt[][];
  readonly tracker: Tracker;
  private points: Stop[];
  private graph: StreetGraph | null = null;
  private guidance: GuidanceState;
  private listeners = new Set<() => void>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private stopCompass: (() => void) | null = null;
  private lastFix: TrackFix | null = null;

  // путь к текущей цели
  private approach: WalkPath | null = null;
  private approachTarget = -1;
  private offFixes = 0;
  private lastReroute = -Infinity;
  private wasOnPath = false;
  private nearFor = -1;
  private turnAnnounced: { path: WalkPath; at: number } | null = null;
  private routeBearing: number | null = null;
  private compass: number | null = null;
  private gpsHeading: { deg: number; at: number } | null = null;
  private course: { deg: number; at: number; from: Pt } | null = null;

  view: WalkView;

  constructor(
    private bundle: CityBundle,
    readonly route: RouteData,
  ) {
    const byId = new Map(bundle.places.map((p) => [p.id, p]));
    this.stops = route.stops.map((id) => byId.get(id)!);
    this.legs = route.legs.map((l) => l.points);
    this.points = this.stops.map((p) => {
      const at = p.listen_at ?? p.location;
      return { lat: at.lat, lon: at.lon, radiusM: p.arrival_radius_m };
    });
    const saved = savedProgress(bundle.city.id, route.id);
    const done = saved?.done?.length === this.stops.length ? saved.done : this.stops.map(() => false);
    const active = Math.min(saved?.active ?? 0, this.stops.length);
    this.guidance = initialGuidance(active);
    this.view = {
      started: false,
      active,
      arrived: null,
      done,
      finished: active >= this.stops.length,
      me: null,
      distanceM: null,
      instruction: null,
      ahead: null,
      heading: null,
      mapBearing: null,
      compassOn: false,
    };
    this.tracker = new Tracker(
      (f) => this.onFix(f),
      () => this.emit(),
    );
  }

  /** Граф улиц города — для пути «от меня до точки». */
  async loadStreets(): Promise<void> {
    if (!this.bundle.streets) return;
    try {
      const res = await fetch(import.meta.env.BASE_URL + this.bundle.streets);
      if (res.ok) this.graph = new StreetGraph((await res.json()) as StreetsData);
    } catch {
      /* без графа — пунктир по прямой */
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Вызывать из нажатия «Начать»: звук и геопозиция. */
  start(): void {
    player.unlock();
    if (this.view.started) return;
    this.view = { ...this.view, started: true };
    this.tracker.start();
    this.startCompass();
    this.tick = setInterval(() => {
      // Стоим на месте — GPS присылает отметки редко; прибытие проверяем по времени сами.
      if (this.lastFix) this.update({ ...this.lastFix, time: Date.now() }, false);
    }, 1000);
    if (this.bundle.phrases.start && this.view.active === 0) player.play(this.bundle.phrases.start);
    this.emit();
  }

  /** На Android компас включается сам; на iPhone — после разрешения по нажатию. */
  startCompass(): void {
    if (this.stopCompass) return;
    this.stopCompass = listenCompass(DECLINATION, (deg) => {
      this.compass = deg;
      if (!this.view.compassOn) this.view = { ...this.view, compassOn: true };
      this.refreshHeading();
    });
  }

  dispose(): void {
    this.tracker.stop();
    if (this.tick) clearInterval(this.tick);
    this.stopCompass?.();
    player.stop();
  }

  /* ---------- действия ---------- */

  /** «Я на месте» — без геопозиции или если она неточная. */
  arriveHere(): void {
    const u = arriveManually(this.points, this.guidance);
    this.applyArrival(u.state, u.reached);
  }

  /** Пропустить текущую точку. */
  skip(): void {
    if (this.view.active >= this.stops.length) return;
    player.stop();
    this.guidance = { active: this.guidance.active + 1, dwell: null };
    this.setView({ active: this.guidance.active, finished: this.guidance.active >= this.stops.length, arrived: null });
    this.persist();
    this.recalc();
  }

  /** Закрыть рассказ и идти дальше. */
  continueWalk(): void {
    player.stop();
    this.setView({ arrived: null });
    if (!this.view.finished && this.bundle.phrases.next) player.play(this.bundle.phrases.next);
    this.recalc();
  }

  /** Открыть рассказ остановки вручную (нажали на точку на карте). */
  openStop(i: number): void {
    this.setView({ arrived: i });
  }

  playStory(i: number): void {
    const url = this.stops[i]?.audio;
    if (url) player.play(url);
  }

  restart(): void {
    player.stop();
    this.guidance = initialGuidance(0);
    this.setView({ active: 0, arrived: null, finished: false, done: this.stops.map(() => false) });
    this.persist();
    this.recalc();
  }

  /* ---------- геопозиция ---------- */

  private onFix(f: TrackFix): void {
    this.lastFix = f;
    if (f.heading !== null) this.gpsHeading = { deg: f.heading, at: f.time };
    const here: Pt = [f.lat, f.lon];
    if (!this.course) this.course = { deg: NaN, at: 0, from: here };
    else if (dist(this.course.from, here) >= COURSE_STEP_M) {
      this.course = { deg: bearingDegrees(this.course.from, here), at: f.time, from: here };
    }
    this.update(f, true);
  }

  private recalc(): void {
    if (this.lastFix) this.update({ ...this.lastFix, time: Date.now() }, true);
    else this.emit();
  }

  private update(f: TrackFix, full: boolean): void {
    const fix = { lat: f.lat, lon: f.lon, accuracyM: f.accuracyM, time: f.time };
    if (full) this.updatePath([f.lat, f.lon]);
    if (this.view.arrived !== null || this.view.finished) {
      this.emit();
      return;
    }
    const u = updateGuidance(this.points, this.guidance, fix, DEFAULT_GUIDANCE);
    if (u.reached.length) this.applyArrival(u.state, u.reached);
    else {
      this.guidance = u.state;
      this.emit();
    }
  }

  private applyArrival(state: GuidanceState, reached: number[]): void {
    this.guidance = state;
    const done = this.view.done.slice();
    for (const i of reached) done[i] = true;
    const at = reached[reached.length - 1];
    this.setView({ active: state.active, done, arrived: at, finished: state.active >= this.stops.length });
    this.persist();
    const story = this.stops[at]?.audio;
    const finish = this.view.finished ? this.bundle.phrases.finish : undefined;
    const clips = [story, finish].filter((x): x is string => !!x);
    if (clips.length) player.play(...clips);
    else player.stop();
  }

  /** Путь до текущей цели, расстояние, подсказка о повороте. */
  private updatePath(me: Pt): void {
    const target = this.view.active;
    if (target >= this.stops.length) {
      this.setView({ me, distanceM: null, instruction: null, ahead: null }, false);
      this.refreshHeading();
      return;
    }
    const goal: Pt = [this.points[target].lat, this.points[target].lon];
    if (this.approachTarget !== target) {
      this.approach = target > 0 && this.legs[target - 1]?.length ? new WalkPath(this.legs[target - 1]) : null;
      this.approachTarget = target;
      this.offFixes = 0;
      this.wasOnPath = false;
      this.turnAnnounced = null;
    }
    const path = this.approach;
    const pr = path?.progress(me);
    let shown = me;
    let distanceM = dist(me, goal);
    let instruction: Instruction | null = null;
    let ahead: Ahead = { pts: [me, goal], straight: true };
    this.routeBearing = null;
    if (path && pr && pr.off <= ON_PATH_M) {
      this.offFixes = 0;
      this.wasOnPath = true;
      shown = path.pointAt(pr.along);
      distanceM = pr.remaining;
      ahead = { pts: path.remainingFrom(pr.along), straight: false };
      instruction = path.nextInstruction(pr.along);
      const forward = path.pointAt(pr.along + 20);
      if (dist(shown, forward) > 3) this.routeBearing = bearingDegrees(shown, forward);
      this.announceTurn(path, instruction);
    } else {
      this.offFixes++;
      this.reroute(me, goal, !!path);
    }
    const radius = this.points[target].radiusM ?? DEFAULT_GUIDANCE.arrivalRadiusM;
    if (this.nearFor !== target && distanceM <= NEAR_M && distanceM > radius) {
      this.nearFor = target;
      if (this.bundle.phrases.near && !player.current) player.play(this.bundle.phrases.near);
    }
    this.setView({ me: shown, distanceM, instruction, ahead }, false);
    this.refreshHeading();
  }

  /** Свернули или пути ещё нет — строим от того места, где стоим, по улицам города. */
  private reroute(me: Pt, goal: Pt, hadPath: boolean): void {
    const now = Date.now();
    if (!this.graph || now - this.lastReroute < REROUTE_INTERVAL_MS) return;
    if (hadPath && this.offFixes < REROUTE_CONFIRM_FIXES) return;
    this.lastReroute = now;
    if (hadPath && this.wasOnPath) {
      this.wasOnPath = false;
      if (this.bundle.phrases.off_route && !player.current) player.play(this.bundle.phrases.off_route);
    }
    const line = this.graph.route(me, goal);
    if (line) {
      this.approach = new WalkPath(line);
      this.offFixes = 0;
      this.turnAnnounced = null;
      this.updatePath(me);
    }
  }

  private announceTurn(path: WalkPath, next: Instruction): void {
    if (!next.turn || next.at === null || next.inMeters > TURN_ANNOUNCE_M) return;
    const same = this.turnAnnounced && this.turnAnnounced.path === path && Math.abs(this.turnAnnounced.at - next.at) <= 1;
    if (same) return;
    this.turnAnnounced = { path, at: next.at };
    const clip = this.bundle.phrases[next.turn === 'left' ? 'turn_left' : next.turn === 'right' ? 'turn_right' : next.turn];
    // Рассказ не перебиваем: поворот видно на плашке.
    if (clip && !player.current) player.play(clip);
  }

  /** Куда смотрит телефон: компас, свежий курс GPS или направление по последним метрам. */
  private refreshHeading(): void {
    const now = Date.now();
    let heading: number | null = null;
    if (this.compass !== null) heading = this.compass;
    else if (this.gpsHeading && now - this.gpsHeading.at < 5000) heading = this.gpsHeading.deg;
    else if (this.course && Number.isFinite(this.course.deg) && now - this.course.at < 15000) heading = this.course.deg;
    this.setView({ heading, mapBearing: this.routeBearing ?? heading });
  }

  private persist(): void {
    save(storeKey(this.bundle.city.id, this.route.id), JSON.stringify({ active: this.view.active, done: this.view.done }));
  }

  private setView(patch: Partial<WalkView>, emit = true): void {
    this.view = { ...this.view, ...patch };
    if (emit) this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
