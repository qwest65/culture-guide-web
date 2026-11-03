/**
 * Геопозиция. У сайта с иконки «Домой» на iPhone постоянное слежение (watchPosition) иногда
 * молча не запускается — ни окна разрешения, ни ошибки. Поэтому, как в «Маленьком караване»:
 * сначала разовый запрос (он показывает окно «Разрешить?»), потом слежение, а если оно молчит
 * дольше 10 секунд — разовые запросы каждые 3 секунды и перезапуск слежения раз в 30 секунд.
 */
export type GeoStatus = 'idle' | 'wait' | 'ok' | 'denied' | 'nosignal' | 'unsupported';

export type TrackFix = { lat: number; lon: number; accuracyM: number; speed: number | null; heading: number | null; time: number };

const OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 };

export class Tracker {
  status: GeoStatus = 'idle';
  since = 0;
  lastFixAt = 0;
  lastError: string | null = null;
  private watch: number | null = null;
  private watchAt = 0;
  private asking = false;
  private askedAt = 0;
  private poll: ReturnType<typeof setInterval> | null = null;

  constructor(
    private onFix: (fix: TrackFix) => void,
    private onStatus: () => void,
  ) {}

  start(): void {
    if (!('geolocation' in navigator)) {
      this.status = 'unsupported';
      this.onStatus();
      return;
    }
    if (this.status !== 'ok') {
      this.status = 'wait';
      this.since = Date.now();
    }
    this.askOnce();
    this.startWatch(false);
    this.poll ??= setInterval(() => {
      const now = Date.now();
      if (now - this.lastFixAt > 10000) {
        if (this.asking && now - this.askedAt > 25000) this.asking = false;
        this.askOnce();
        if (now - this.watchAt > 30000) this.startWatch(true);
      }
      this.onStatus();
    }, 3000);
    this.onStatus();
  }

  stop(): void {
    if (this.watch !== null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null;
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    if (this.status === 'ok') this.status = 'idle';
  }

  /** Давно ждём, а координат нет. */
  get failing(): boolean {
    return this.status === 'denied' || this.status === 'unsupported' || (this.status !== 'ok' && Date.now() - this.since > 20000);
  }

  private startWatch(restart: boolean) {
    if (restart && this.watch !== null) {
      navigator.geolocation.clearWatch(this.watch);
      this.watch = null;
    }
    if (this.watch !== null) return;
    this.watchAt = Date.now();
    this.watch = navigator.geolocation.watchPosition(this.handle, this.fail, OPTIONS);
  }

  private askOnce() {
    if (this.asking) return;
    this.asking = true;
    this.askedAt = Date.now();
    navigator.geolocation.getCurrentPosition(
      (p) => {
        this.asking = false;
        this.handle(p);
      },
      (e) => {
        this.asking = false;
        this.fail(e);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  private handle = (pos: GeolocationPosition) => {
    const c = pos.coords;
    this.status = 'ok';
    this.lastFixAt = Date.now();
    this.onFix({
      lat: c.latitude,
      lon: c.longitude,
      accuracyM: c.accuracy,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      heading: Number.isFinite(c.heading) && (c.speed ?? 0) >= 1 ? c.heading : null,
      time: Date.now(),
    });
  };

  private fail = (err: GeolocationPositionError) => {
    this.lastError = `код ${err.code}${err.message ? `: ${err.message}` : ''}`;
    if (err.code === err.PERMISSION_DENIED) {
      this.status = 'denied';
      this.stop();
    } else if (this.status !== 'ok') {
      this.status = err.code === err.POSITION_UNAVAILABLE ? 'nosignal' : 'wait';
    }
    this.onStatus();
  };
}

/** Что писать, пока координат нет. */
export function geoMessage(t: Tracker): string {
  if (t.status === 'denied') return 'Доступ к геопозиции запрещён. У точки нажмите «Я на месте».';
  if (t.status === 'unsupported') return 'Браузер не определяет геопозицию. У точки нажмите «Я на месте».';
  if (t.failing) return 'Геопозиция не приходит. У точки нажмите «Я на месте».';
  if (t.status === 'nosignal') return 'Ловим GPS… Выйдите на открытое место.';
  return 'Определяем, где вы… Если телефон спросит про геопозицию — нажмите «Разрешить».';
}
