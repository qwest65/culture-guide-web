/**
 * Открытка в духе русских открыток 1900-х: состаренная бумага, двойная рамка с уголками-орнаментами,
 * «Гор. Троицкъ» вверху, фото в золотой рамке (под снегом — к Новому году и Рождеству), крупная
 * надпись шрифтом с ятями, «Кому» и «Отъ кого» на линейках, как на обороте почтовой карточки.
 * 1080×1350 — хорошо смотрится в Telegram, MAX, ВКонтакте и в сторис.
 */
import { OLD } from './fonts';

export const W = 1080;
export const H = 1350;

const PAPER = '#f2e7cf';
const INK = '#2b1d14';
const RED = '#7a1f1a';
const GOLD = '#a8803a';
const BROWN = '#8a3b12';

export type PostcardInput = {
  photo: CanvasImageSource & { width: number; height: number };
  /** Архивный снимок — тонируем в сепию; современный — тёплый, чуть приглушённый. */
  archive: boolean;
  caption: string;
  greeting: string;
  wish: string;
  to: string;
  from: string;
  /** Шапка: «Гор. Троицкъ» / «Город Троицк». */
  header: string;
  /** Подпись «Отъ кого» в старой орфографии. */
  oldSpelling: boolean;
  /** Снег на фото — к Новому году и Рождеству. */
  snow: boolean;
  site: string;
  /** Зерно для снега и пятнышек бумаги — чтобы картинка не прыгала при каждом нажатии. */
  seed?: number;
  /** Отрезать снизу долю кадра (служебная полоска архива PastVu). */
  cropBottom?: number;
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function cover(g: CanvasRenderingContext2D, img: PostcardInput['photo'], x: number, y: number, w: number, h: number, crop = 0) {
  const iw = img.width;
  const ih = img.height * (1 - crop);
  const s = Math.max(w / iw, h / ih);
  const cw = w / s;
  const ch = h / s;
  g.drawImage(img, (iw - cw) / 2, (ih - ch) / 2, cw, ch, x, y, w, h);
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Уголок-орнамент: завиток из двух дуг и ромбик. */
function corner(g: CanvasRenderingContext2D, x: number, y: number, sx: number, sy: number) {
  g.save();
  g.translate(x, y);
  g.scale(sx, sy);
  g.strokeStyle = BROWN;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 70);
  g.bezierCurveTo(0, 20, 20, 0, 70, 0);
  g.stroke();
  g.beginPath();
  g.moveTo(14, 70);
  g.bezierCurveTo(14, 34, 34, 14, 70, 14);
  g.stroke();
  g.beginPath();
  g.arc(36, 36, 9, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = BROWN;
  g.beginPath();
  g.moveTo(36, 22);
  g.lineTo(42, 36);
  g.lineTo(36, 50);
  g.lineTo(30, 36);
  g.closePath();
  g.fill();
  g.restore();
}

/** Разделитель: линия — ромб — линия. */
function divider(g: CanvasRenderingContext2D, cx: number, y: number, half: number) {
  g.strokeStyle = GOLD;
  g.fillStyle = GOLD;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx - half, y);
  g.lineTo(cx - 18, y);
  g.moveTo(cx + 18, y);
  g.lineTo(cx + half, y);
  g.stroke();
  g.beginPath();
  g.moveTo(cx, y - 9);
  g.lineTo(cx + 12, y);
  g.lineTo(cx, y + 9);
  g.lineTo(cx - 12, y);
  g.closePath();
  g.fill();
}

/** Снежинка из шести лучей. */
function flake(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.stroke();
}

export function drawPostcard(c: HTMLCanvasElement, p: PostcardInput): void {
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rand = rng(p.seed ?? 1911);

  // Бумага: тёплая, к краям темнее, с редкими пятнышками времени
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);
  const vign = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
  vign.addColorStop(0, 'rgba(255,250,235,0.35)');
  vign.addColorStop(1, 'rgba(120,80,30,0.28)');
  g.fillStyle = vign;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(110,75,35,${0.03 + rand() * 0.07})`;
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 2.2, 1 + rand() * 2.2);
  }

  // Двойная рамка и уголки
  g.strokeStyle = BROWN;
  g.lineWidth = 4;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.lineWidth = 1.5;
  g.strokeRect(48, 48, W - 96, H - 96);
  corner(g, 56, 56, 1, 1);
  corner(g, W - 56, 56, -1, 1);
  corner(g, 56, H - 56, 1, -1);
  corner(g, W - 56, H - 56, -1, -1);

  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';

  // «Изъ Троицка»
  g.fillStyle = BROWN;
  g.font = `400 34px ${OLD}`;
  const head = p.header.toUpperCase().split('').join(' ');
  g.fillText(head, W / 2, 118);
  divider(g, W / 2, 140, 220);

  // Фото в золотой рамке, под снегом
  const px = 110;
  const py = 170;
  const pw = W - 220;
  const ph = 600;
  g.save();
  g.shadowColor = 'rgba(60,35,10,0.35)';
  g.shadowBlur = 18;
  g.shadowOffsetY = 6;
  g.fillStyle = '#fff';
  g.fillRect(px - 14, py - 14, pw + 28, ph + 28);
  g.restore();
  g.strokeStyle = GOLD;
  g.lineWidth = 3;
  g.strokeRect(px - 8, py - 8, pw + 16, ph + 16);
  g.save();
  g.beginPath();
  g.rect(px, py, pw, ph);
  g.clip();
  g.filter = p.archive ? 'sepia(0.55) contrast(1.05) brightness(1.02)' : 'sepia(0.18) saturate(0.85) brightness(1.03)';
  cover(g, p.photo, px, py, pw, ph, p.cropBottom ?? 0);
  g.filter = 'none';
  // зимний воздух: лёгкая дымка сверху и сугроб снизу
  if (p.snow) {
  const air = g.createLinearGradient(0, py, 0, py + ph);
  air.addColorStop(0, 'rgba(225,235,245,0.18)');
  air.addColorStop(0.75, 'rgba(255,255,255,0)');
  air.addColorStop(1, 'rgba(255,255,255,0.55)');
  g.fillStyle = air;
  g.fillRect(px, py, pw, ph);
  }
  // снег: хлопья разного размера, дальние — мельче и прозрачнее
  for (let i = 0; i < (p.snow ? 340 : 0); i++) {
    const r = rand();
    const size = r < 0.7 ? 1.4 + rand() * 2.4 : 3.5 + rand() * 5;
    g.fillStyle = `rgba(255,255,255,${0.45 + rand() * 0.5})`;
    g.beginPath();
    g.arc(px + rand() * pw, py + rand() * ph, size, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 2;
  for (let i = 0; i < (p.snow ? 12 : 0); i++) flake(g, px + rand() * pw, py + rand() * ph * 0.8, 9 + rand() * 10);
  g.restore();

  // Подпись к фото
  g.fillStyle = '#5a4632';
  g.font = `italic 400 26px ${OLD}`;
  g.fillText(p.caption, W / 2, py + ph + 52);

  // Поздравление
  g.fillStyle = RED;
  let size = 92;
  g.font = `700 ${size}px ${OLD}`;
  while (g.measureText(p.greeting).width > W - 180 && size > 50) {
    size -= 4;
    g.font = `700 ${size}px ${OLD}`;
  }
  const gy = py + ph + 52 + 20 + size;
  g.save();
  g.shadowColor = 'rgba(122,31,26,0.18)';
  g.shadowOffsetY = 3;
  g.fillText(p.greeting, W / 2, gy);
  g.restore();
  divider(g, W / 2, gy + 34, 160);

  // Пожелание
  g.fillStyle = INK;
  g.font = `italic 400 34px ${OLD}`;
  const lines = wrap(g, p.wish, W - 240).slice(0, 2);
  lines.forEach((l, i) => g.fillText(l, W / 2, gy + 86 + i * 44));

  // Кому / Отъ кого — на линейках, как на почтовой карточке
  g.textAlign = 'left';
  const ly = H - 168;
  const rows: [string, string][] = [
    ['Кому:', p.to],
    [p.oldSpelling ? 'Отъ кого:' : 'От кого:', p.from],
  ];
  rows.forEach(([label, value], i) => {
    const y = ly + i * 56;
    g.fillStyle = BROWN;
    g.font = `400 28px ${OLD}`;
    g.fillText(label, 110, y);
    const lx = 110 + g.measureText(label).width + 16;
    g.strokeStyle = 'rgba(138,59,18,0.45)';
    g.lineWidth = 1.5;
    g.setLineDash([2, 6]);
    g.beginPath();
    g.moveTo(lx, y + 8);
    g.lineTo(W - 110, y + 8);
    g.stroke();
    g.setLineDash([]);
    if (value) {
      g.fillStyle = INK;
      g.font = `italic 400 34px ${OLD}`;
      let v = value;
      while (g.measureText(v).width > W - 120 - lx && v.length > 2) v = v.slice(0, -1);
      g.fillText(v, lx + 6, y);
    }
  });

  // Тонкая подпись гида
  g.textAlign = 'center';
  g.fillStyle = 'rgba(90,70,50,0.7)';
  g.font = `400 21px ${OLD}`;
  g.fillText(p.site, W / 2, H - 60);
}
