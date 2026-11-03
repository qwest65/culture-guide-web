/**
 * Карта прогулки — как навигатор в «Маленьком караване»: своя подложка из public/map/<город>/
 * (чужой сервер карт у части провайдеров заблокирован), камера следует за человеком,
 * карта повёрнута по пути. Сдвинули пальцем — слежение выключается и само возвращается через 8 с.
 *
 * Модуль грузится отдельно (import()), только на экране прогулки: страницы города и объектов
 * остаются лёгкими.
 */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, Marker, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Pt } from '../lib/streets';

maplibregl.setWorkerUrl(workerUrl);

const FOLLOW_ZOOM = 17.5;
const FOLLOW_PITCH = 40;
const RESUME_FOLLOW_MS = 8000;
const MIN_ZOOM = 11;

const BLANK_STYLE = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'bg', type: 'background' as const, paint: { 'background-color': '#ece6da' } }],
};

/**
 * Своя подложка: style.json из public/map/<город>/. Адреса внутри него — относительно папки стиля,
 * а карте нужны полные, поэтому дополняем их здесь. null — подложка не загрузилась.
 */
export async function loadStyle(styleUrl: string): Promise<StyleSpecification | null> {
  try {
    const url = new URL(styleUrl, document.baseURI).href;
    const res = await fetch(url);
    if (!res.ok) return null;
    const style = (await res.json()) as StyleSpecification;
    const abs = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : new URL(u, url).href.replace(/%7B/g, '{').replace(/%7D/g, '}'));
    for (const src of Object.values(style.sources)) {
      const s = src as { tiles?: string[]; url?: string };
      if (s.tiles) s.tiles = s.tiles.map(abs);
      if (s.url) s.url = abs(s.url);
    }
    if (typeof style.sprite === 'string') style.sprite = abs(style.sprite);
    // Подписи — по-русски: стиль OpenFreeMap пишет латиницу и оригинал вместе.
    for (const layer of style.layers) {
      const layout = (layer as { layout?: Record<string, unknown> }).layout;
      if (layout && JSON.stringify(layout['text-field'] ?? '').includes('name:latin')) {
        layout['text-field'] = ['coalesce', ['get', 'name:ru'], ['get', 'name:nonlatin'], ['get', 'name']];
      }
    }
    if (style.glyphs) style.glyphs = abs(style.glyphs);
    return style;
  } catch {
    return null;
  }
}

export type StopMark = { pt: Pt; label: string; title: string; state: 'done' | 'target' | 'todo' };

const line = (pts: Pt[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: pts.map((p) => [p[1], p[0]]) },
});
const collection = (features: ReturnType<typeof line>[]) => ({ type: 'FeatureCollection' as const, features });

export class WalkMap {
  private map: MLMap;
  private ready = false;
  private markers: Marker[] = [];
  private me: Marker | null = null;
  private meAt: Pt | null = null;
  private resume: ReturnType<typeof setTimeout> | null = null;
  private pending: { route?: Pt[][]; ahead?: { pts: Pt[]; straight: boolean } | null } = {};
  following = true;
  onFollowChange: (following: boolean) => void = () => {};

  constructor(container: HTMLElement, style: StyleSpecification | null, center: Pt) {
    this.map = new maplibregl.Map({
      container,
      style: style ?? BLANK_STYLE,
      center: [center[1], center[0]],
      zoom: 15,
      minZoom: MIN_ZOOM,
      attributionControl: { compact: true },
      pitchWithRotate: false,
    });
    this.map.touchPitch.disable();
    let fellBack = false;
    this.map.on('error', (e) => {
      // Подложка не загрузилась — линии и точки на простом фоне.
      const msg = String((e as { error?: { message?: string } }).error?.message ?? '');
      if (!fellBack && !this.ready && /style|Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        fellBack = true;
        this.map.setStyle(BLANK_STYLE);
      }
    });
    this.map.on('style.load', () => {
      this.ready = true;
      this.addLayers();
      if (this.pending.route) this.setRoute(this.pending.route);
      if (this.pending.ahead !== undefined) this.setAhead(this.pending.ahead);
    });
    const userMoves = () => {
      this.setFollowing(false);
      if (this.resume) clearTimeout(this.resume);
    };
    this.map.on('dragstart', userMoves);
    this.map.on('rotatestart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) userMoves();
    });
    this.map.on('moveend', (e) => {
      if (!this.following && ((e as { originalEvent?: unknown }).originalEvent || (e as { fit?: boolean }).fit)) {
        if (this.resume) clearTimeout(this.resume);
        this.resume = setTimeout(() => this.follow(), RESUME_FOLLOW_MS);
      }
    });
  }

  get bearing() {
    return this.map.getBearing();
  }

  destroy() {
    if (this.resume) clearTimeout(this.resume);
    this.map.remove();
  }

  private setFollowing(v: boolean) {
    if (this.following === v) return;
    this.following = v;
    this.onFollowChange(v);
  }

  private addLayers() {
    const m = this.map;
    if (!m.getSource('route')) m.addSource('route', { type: 'geojson', data: collection([]) });
    if (!m.getSource('ahead')) m.addSource('ahead', { type: 'geojson', data: collection([]) });
    if (!m.getLayer('route')) {
      m.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#233d4d', 'line-opacity': 0.45, 'line-width': 5 },
      });
    }
    if (!m.getLayer('ahead')) {
      m.addLayer({
        id: 'ahead',
        type: 'line',
        source: 'ahead',
        filter: ['!=', ['get', 'straight'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#c75b12', 'line-width': 7 },
      });
      m.addLayer({
        id: 'ahead-straight',
        type: 'line',
        source: 'ahead',
        filter: ['==', ['get', 'straight'], true],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#c75b12', 'line-width': 5, 'line-dasharray': [0.5, 2] },
      });
    }
  }

  /** Весь маршрут — участки по улицам. */
  setRoute(legs: Pt[][]) {
    this.pending.route = legs;
    if (!this.ready) return;
    (this.map.getSource('route') as GeoJSONSource).setData(collection(legs.map(line)));
  }

  /** Путь впереди: по улицам или, пока его нет, пунктиром по прямой. */
  setAhead(ahead: { pts: Pt[]; straight: boolean } | null) {
    this.pending.ahead = ahead;
    if (!this.ready) return;
    const data = ahead ? collection([{ ...line(ahead.pts), properties: { straight: ahead.straight } } as ReturnType<typeof line>]) : collection([]);
    (this.map.getSource('ahead') as GeoJSONSource).setData(data);
  }

  setStops(stops: StopMark[], onTap: (i: number) => void) {
    for (const m of this.markers) m.remove();
    this.markers = stops.map((s, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `stop-pin ${s.state}`;
      el.textContent = s.label;
      el.setAttribute('aria-label', `${s.label}. ${s.title}`);
      el.addEventListener('click', () => onTap(i));
      return new maplibregl.Marker({ element: el }).setLngLat([s.pt[1], s.pt[0]]).addTo(this.map);
    });
  }

  /** Стрелка «я». heading — куда смотрит телефон или куда идём; null — неизвестно. */
  setMe(pt: Pt, heading: number | null) {
    this.meAt = pt;
    if (!this.me) {
      const el = document.createElement('div');
      el.className = 'me';
      el.innerHTML = '<div class="me-arrow"></div><div class="me-dot"></div>';
      this.me = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([pt[1], pt[0]])
        .addTo(this.map);
    } else this.me.setLngLat([pt[1], pt[0]]);
    const me = this.me!;
    me.getElement().classList.toggle('has-heading', heading !== null);
    if (heading !== null) me.setRotation(heading);
  }

  /** Камера навигатора: мы в центре чуть ниже середины, карта повёрнута по направлению. */
  followCamera(bearing: number | null, duration = 500) {
    if (!this.following || !this.meAt) return;
    this.map.easeTo({
      center: [this.meAt[1], this.meAt[0]],
      zoom: FOLLOW_ZOOM,
      bearing: bearing ?? this.map.getBearing(),
      pitch: FOLLOW_PITCH,
      padding: { top: 0, bottom: Math.round(this.map.getContainer().clientHeight * 0.3), left: 0, right: 0 },
      duration,
    });
  }

  follow() {
    if (this.resume) clearTimeout(this.resume);
    this.setFollowing(true);
    this.followCamera(null);
  }

  north() {
    this.setFollowing(false);
    if (this.resume) clearTimeout(this.resume);
    this.map.easeTo({ bearing: 0, pitch: 0, duration: 400 });
    this.resume = setTimeout(() => this.follow(), RESUME_FOLLOW_MS);
  }

  /** Показать весь маршрут (и нас, если знаем где). */
  fit(points: Pt[], bottomPad: number) {
    const all = this.meAt ? [...points, this.meAt] : points;
    if (!all.length) return;
    const b = new maplibregl.LngLatBounds([all[0][1], all[0][0]], [all[0][1], all[0][0]]);
    for (const p of all) b.extend([p[1], p[0]]);
    this.setFollowing(false);
    if (this.resume) clearTimeout(this.resume);
    this.map.fitBounds(
      b,
      { padding: { top: 90, bottom: bottomPad, left: 40, right: 40 }, maxZoom: 17, duration: 500, bearing: 0, pitch: 0 },
      { fit: true },
    );
  }
}
