/**
 * «Открытка прогулки»: после маршрута — картинка 1080×1350 (формат, который хорошо смотрится
 * в Telegram, MAX и сторис): название маршрута, нарисованный путь с номерами мест, километры,
 * число мест, дата и до трёх «было/стало» с прогулки. Карта рисуется сама — без подложки,
 * чтобы картинка собиралась мгновенно и без интернета.
 */
import type { PlaceData } from '../content/bundle';
import { formatDistance } from '../lib/format';

const base = import.meta.env.BASE_URL;
const SITE = 'culture-guide.mooo.com';
const W = 1080;
const H = 1350;
const PAD = 64;
const INK = '#1d1b18';
const PAPER = '#f6f2ea';
const ACCENT = '#c75b12';
const NAVY = '#233d4d';

type Pt = [number, number];

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const cw = w / s;
  const ch = h / s;
  g.drawImage(img, (img.naturalWidth - cw) / 2, (img.naturalHeight - ch) / 2, cw, ch, x, y, w, h);
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function fitText(g: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && g.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

export async function makeWalkCard(opts: {
  city: string;
  route: string;
  stops: PlaceData[];
  legs: Pt[][];
  distanceM: number;
}): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  // фон: бумага и тонкая рамка, как у открытки
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(138,59,18,0.35)';
  g.lineWidth = 3;
  g.strokeRect(24, 24, W - 48, H - 48);

  // заголовок
  g.fillStyle = '#8a3b12';
  g.font = '600 30px system-ui, -apple-system, Roboto, sans-serif';
  g.fillText(`${opts.city.toUpperCase()} · МОЯ ПРОГУЛКА`, PAD, 100);
  g.fillStyle = INK;
  g.font = '600 66px Georgia, "Times New Roman", serif';
  g.fillText(fitText(g, opts.route, W - PAD * 2), PAD, 180);

  // карта пути
  const mapY = 220;
  const mapH = 560;
  rounded(g, PAD, mapY, W - PAD * 2, mapH, 28);
  g.fillStyle = '#ece4d4';
  g.fill();
  const pts: Pt[] = [...opts.legs.flat(), ...opts.stops.map((s) => [s.location.lat, s.location.lon] as Pt)];
  if (pts.length) {
    const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * kx);
    const ys = pts.map((p) => p[0]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const inner = 70;
    const bw = W - PAD * 2 - inner * 2;
    const bh = mapH - inner * 2;
    const scale = Math.min(bw / Math.max(maxX - minX, 1e-6), bh / Math.max(maxY - minY, 1e-6));
    const ox = PAD + inner + (bw - (maxX - minX) * scale) / 2;
    const oy = mapY + inner + (bh - (maxY - minY) * scale) / 2;
    const P = (p: Pt): [number, number] => [ox + (p[1] * kx - minX) * scale, oy + (maxY - p[0]) * scale];

    // путь: светлая подложка и тёмная линия
    const lines = opts.legs.length ? opts.legs : [opts.stops.map((s) => [s.location.lat, s.location.lon] as Pt)];
    for (const [w, col] of [
      [18, 'rgba(255,255,255,0.9)'],
      [9, NAVY],
    ] as const) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const line of lines) {
        g.beginPath();
        line.forEach((p, i) => {
          const [x, y] = P(p);
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        });
        g.stroke();
      }
    }
    // места
    opts.stops.forEach((s, i) => {
      const [x, y] = P([s.location.lat, s.location.lon]);
      g.beginPath();
      g.arc(x, y, 26, 0, Math.PI * 2);
      g.fillStyle = i === 0 || i === opts.stops.length - 1 ? ACCENT : NAVY;
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = '#fff';
      g.stroke();
      g.fillStyle = '#fff';
      g.font = '700 26px system-ui, -apple-system, Roboto, sans-serif';
      const t = String(i + 1);
      g.fillText(t, x - g.measureText(t).width / 2, y + 9);
    });
  }

  // цифры
  const statY = 860;
  const stats: [string, string][] = [
    [formatDistance(opts.distanceM), 'пешком'],
    [String(opts.stops.length), opts.stops.length % 10 === 1 && opts.stops.length % 100 !== 11 ? 'место' : opts.stops.length % 10 >= 2 && opts.stops.length % 10 <= 4 && (opts.stops.length % 100 < 12 || opts.stops.length % 100 > 14) ? 'места' : 'мест'],
    [new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }), String(new Date().getFullYear())],
  ];
  const colW = (W - PAD * 2) / 3;
  stats.forEach(([big, small], i) => {
    const x = PAD + colW * i;
    g.fillStyle = ACCENT;
    g.font = '600 52px Georgia, "Times New Roman", serif';
    g.fillText(fitText(g, big, colW - 20), x, statY);
    g.fillStyle = '#5c574f';
    g.font = '400 28px system-ui, -apple-system, Roboto, sans-serif';
    g.fillText(small, x, statY + 40);
  });

  // было/стало с прогулки — до трёх старых снимков
  const old = opts.stops.filter((s) => s.then_now.length).slice(0, 3);
  const thumbY = 990;
  const thumbH = 230;
  if (old.length) {
    g.fillStyle = INK;
    g.font = '600 28px system-ui, -apple-system, Roboto, sans-serif';
    g.fillText('По пути — каким это было', PAD, thumbY - 20);
    const gap = 20;
    const tw = (W - PAD * 2 - gap * (old.length - 1)) / old.length;
    const imgs = await Promise.all(old.map((s) => loadImage(base + s.then_now[0].then.src)));
    imgs.forEach((img, i) => {
      const x = PAD + i * (tw + gap);
      g.save();
      rounded(g, x, thumbY, tw, thumbH, 18);
      g.clip();
      if (img) {
        g.filter = 'sepia(0.35)';
        cover(g, img, x, thumbY, tw, thumbH);
        g.filter = 'none';
      } else {
        g.fillStyle = '#ddd';
        g.fillRect(x, thumbY, tw, thumbH);
      }
      const grad = g.createLinearGradient(0, thumbY + thumbH - 90, 0, thumbY + thumbH);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.75)');
      g.fillStyle = grad;
      g.fillRect(x, thumbY + thumbH - 90, tw, 90);
      g.restore();
      g.fillStyle = '#fff';
      g.font = '700 26px system-ui, -apple-system, Roboto, sans-serif';
      g.fillText(old[i].then_now[0].then.year ?? '', x + 16, thumbY + thumbH - 46);
      g.font = '500 22px system-ui, -apple-system, Roboto, sans-serif';
      g.fillText(fitText(g, old[i].name, tw - 32), x + 16, thumbY + thumbH - 16);
    });
  }

  // подпись
  g.fillStyle = NAVY;
  g.font = '600 34px system-ui, -apple-system, Roboto, sans-serif';
  g.fillText('Культурный гид', PAD, H - 70);
  g.fillStyle = '#5c574f';
  g.font = '400 30px system-ui, -apple-system, Roboto, sans-serif';
  const site = SITE;
  g.fillText(site, W - PAD - g.measureText(site).width, H - 70);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/jpeg', 0.9));
}
