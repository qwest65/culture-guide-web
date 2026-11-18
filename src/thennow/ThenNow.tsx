/**
 * «Окно в прошлое»: было/стало.
 *  - ползунок: тянешь — современный вид «стирается», проступает архивный снимок;
 *  - камера: поверх живой картинки полупрозрачно лежит архивный снимок, совмещаешь ракурс и снимаешь;
 *  - «Поделиться»: готовая картинка было/стало с подписью и адресом гида — в Telegram, MAX и т. д.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlaceData } from '../content/bundle';
import { inAppBrowser, isIOS } from '../walk/device';
import { makeCard, shareCard } from './card';

const base = import.meta.env.BASE_URL;
type Photo = PlaceData['photos'][number];

export const yearLabel = (p: Photo) => p.year ?? 'Было';

export function ThenNow({ place, cityName }: { place: PlaceData; cityName: string }) {
  const tn = place.then_now[0];
  const now = tn?.now ?? place.photos[0];
  const [pos, setPos] = useState(50);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  if (!tn || !now) return null;
  const then = tn.then;

  const dragTo = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  const share = async () => {
    setBusy(true);
    try {
      const card = await makeCard({ then, nowSrc: base + now.src, nowLabel: 'Сейчас', place: place.name, city: cityName });
      await shareCard(card, `${place.name} — было и стало`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="thennow" aria-labelledby="thennow-title">
      <h2 id="thennow-title" class="section-title">
        Было и стало
      </h2>
      <div
        class="tn-compare"
        ref={box}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          dragTo(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && dragTo(e.clientX)}
      >
        <img class="tn-now" src={base + now.src} alt={`${place.name} сейчас`} draggable={false} />
        <img
          class="tn-then"
          src={base + then.src}
          alt={then.caption}
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div class="tn-line" style={{ left: `${pos}%` }} aria-hidden="true">
          <span class="tn-knob">⇆</span>
        </div>
        <span class="tn-tag tn-tag-then">{yearLabel(then)}</span>
        <span class="tn-tag tn-tag-now">Сейчас</span>
        <input
          class="tn-range"
          type="range"
          min={0}
          max={100}
          value={pos}
          aria-label="Сравнить: влево — сейчас, вправо — архивный снимок"
          onInput={(e) => setPos(Number((e.target as HTMLInputElement).value))}
        />
      </div>
      {tn.note && <p class="note">{tn.note}</p>}
      <div class="tn-actions">
        <button type="button" class="button button-primary" onClick={() => setCamera(true)}>
          📷 Совместить с камерой
        </button>
        <button type="button" class="button" onClick={share} disabled={busy}>
          {busy ? 'Готовим…' : '↗ Поделиться'}
        </button>
      </div>
      <p class="tn-credit">
        {then.caption}
        {then.year && `, ${then.year}`}. {then.author},{' '}
        {then.source_url ? (
          <a href={then.source_url} target="_blank" rel="noopener noreferrer">
            {then.license}
          </a>
        ) : (
          then.license
        )}
        .
      </p>
      {camera && <CameraOverlay then={then} place={place.name} city={cityName} onClose={() => setCamera(false)} />}
    </section>
  );
}

/** Камера на весь экран, архивный снимок поверх — совместить и снять. */
function CameraOverlay({ then, place, city, onClose }: { then: Photo; place: string; city: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [opacity, setOpacity] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<Blob | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const md = navigator.mediaDevices;
    if (!md?.getUserMedia) {
      setError(
        inAppBrowser
          ? `Здесь камера недоступна. Откройте гид в ${isIOS ? 'Safari' : 'браузере'}.`
          : 'Этот браузер не даёт доступ к камере.',
      );
      return;
    }
    md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      })
      .catch(() => setError('Нет доступа к камере. Разрешите камеру для этого сайта в настройках браузера.'));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => () => {
    if (shotUrl) URL.revokeObjectURL(shotUrl);
  }, [shotUrl]);

  const capture = async () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const card = await makeCard({ then, nowSrc: v, nowLabel: String(new Date().getFullYear()), place, city });
    setShot(card);
    setShotUrl(URL.createObjectURL(card));
  };

  return (
    <div class="tn-camera" role="dialog" aria-modal="true" aria-label="Совместить с камерой">
      {error ? (
        <div class="tn-cam-error">
          <p>{error}</p>
          <button type="button" class="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      ) : shotUrl ? (
        <div class="tn-result">
          <img src={shotUrl} alt="Ваш снимок было/стало" />
          <div class="tn-cam-bar">
            <button type="button" class="button" onClick={() => (setShot(null), setShotUrl(null))}>
              Переснять
            </button>
            <button type="button" class="button button-primary" onClick={() => shot && shareCard(shot, `${place} — было и стало`)}>
              ↗ Поделиться
            </button>
          </div>
        </div>
      ) : (
        <>
          <video ref={video} class="tn-video" playsInline muted autoPlay />
          <img class="tn-ghost" src={base + then.src} alt="" style={{ opacity: opacity / 100 }} />
          <p class="tn-cam-hint">Совместите старый снимок с тем, что видите, и нажмите «Снять»</p>
          <div class="tn-cam-bar">
            <label class="tn-opacity">
              <span>Прозрачность</span>
              <input type="range" min={10} max={90} value={opacity} onInput={(e) => setOpacity(Number((e.target as HTMLInputElement).value))} />
            </label>
            <button type="button" class="tn-shutter" onClick={capture} aria-label="Снять" />
          </div>
        </>
      )}
      <button type="button" class="tn-close" onClick={onClose} aria-label="Закрыть камеру">
        ✕
      </button>
    </div>
  );
}
