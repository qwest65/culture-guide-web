/**
 * Картинка «было/стало» для пересылки: сверху архивный снимок, снизу современный (или кадр с камеры),
 * название места, годы и адрес гида. 1080 пикселей в ширину — как любят мессенджеры.
 */
const base = import.meta.env.BASE_URL;
const SITE = 'culture-guide.mooo.com';
const W = 1080;
const PAD = 48;
const HEAD = 170;
const FOOT = 120;

type Photo = { src: string; year?: string; author: string; license: string };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Вписать источник в прямоугольник с обрезкой по центру (как object-fit: cover). */
function drawCover(g: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, x, y, w, h);
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
  g.font = '600 40px system-ui, -apple-system, Roboto, sans-serif';
  const w = g.measureText(text).width + 36;
  g.fillStyle = 'rgba(0,0,0,0.62)';
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, 64, 32);
  else g.rect(x, y, w, 64);
  g.fill();
  g.fillStyle = '#fff';
  g.fillText(text, x + 18, y + 46);
}

export async function makeCard(opts: {
  then: Photo;
  nowSrc: string | HTMLVideoElement;
  nowLabel: string;
  place: string;
  city: string;
}): Promise<Blob> {
  const thenImg = await loadImage(base + opts.then.src);
  const ratio = thenImg.naturalHeight / thenImg.naturalWidth;
  const ph = Math.round((W - PAD * 2) * Math.min(Math.max(ratio, 0.6), 1));
  const H = HEAD + ph * 2 + PAD + FOOT;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  g.fillStyle = '#f6f2ea';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#8a3b12';
  g.font = '600 30px system-ui, -apple-system, Roboto, sans-serif';
  g.fillText(`${opts.city.toUpperCase()} · БЫЛО И СТАЛО`, PAD, 66);
  g.fillStyle = '#1d1b18';
  g.font = '600 58px Georgia, "Times New Roman", serif';
  let title = opts.place;
  while (g.measureText(title).width > W - PAD * 2 && title.length > 4) title = title.slice(0, -2);
  g.fillText(title === opts.place ? title : `${title}…`, PAD, 136);

  const y1 = HEAD;
  drawCover(g, thenImg, thenImg.naturalWidth, thenImg.naturalHeight, PAD, y1, W - PAD * 2, ph);
  label(g, opts.then.year ?? 'Было', PAD + 20, y1 + 20);

  const y2 = HEAD + ph + PAD / 2;
  if (typeof opts.nowSrc === 'string') {
    const nowImg = await loadImage(opts.nowSrc);
    drawCover(g, nowImg, nowImg.naturalWidth, nowImg.naturalHeight, PAD, y2, W - PAD * 2, ph);
  } else {
    drawCover(g, opts.nowSrc, opts.nowSrc.videoWidth, opts.nowSrc.videoHeight, PAD, y2, W - PAD * 2, ph);
  }
  label(g, opts.nowLabel, PAD + 20, y2 + 20);

  g.fillStyle = '#5c574f';
  g.font = '400 24px system-ui, -apple-system, Roboto, sans-serif';
  g.fillText(`Архивное фото: ${opts.then.author}, ${opts.then.license}`.slice(0, 80), PAD, H - FOOT + 34);
  g.fillStyle = '#233d4d';
  g.font = '600 36px system-ui, -apple-system, Roboto, sans-serif';
  g.fillText(`Культурный гид · ${SITE}`, PAD, H - 40);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/jpeg', 0.88));
}

/** Поделиться картинкой (телефон) или скачать её (компьютер). */
export async function shareCard(card: Blob, title: string, name = 'bylo-stalo.jpg'): Promise<void> {
  const file = new File([card], name, { type: 'image/jpeg' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text: `${title} — https://${SITE}/` });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(card);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
