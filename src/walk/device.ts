/** Особенности телефонов и браузеров, выученные на «Маленьком караване». */

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** Встроенные браузеры Telegram, ВК, MAX, Instagram и т. п.: там часто нет геопозиции и звука. */
export const inAppBrowser =
  typeof navigator !== 'undefined' && /Telegram|VKClient|vkontakte|Instagram|FBAN|FBAV|OKApp|OneMe|; wv\)/i.test(navigator.userAgent);

/** Открыто с иконки на экране «Домой». */
export const standalone =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

/** Ссылка, открывающая эту же страницу в Safari (iPhone) или в браузере по умолчанию (Android). */
export function browserLink(): string {
  const url = location.href;
  if (isIOS) return `x-safari-${url}`;
  return `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;end`;
}

/** Не гасить экран во время прогулки. */
let wakeLock: { release: () => Promise<void> } | null = null;
export async function keepAwake(on: boolean): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<typeof wakeLock> } };
    if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* не поддерживается — экран может погаснуть */
  }
}

/**
 * Компас. На Android включается сам, на iPhone нужно разрешение по нажатию.
 * Возвращает функцию отписки. Направление — градусы от истинного севера.
 */
export const compassNeedsTap =
  typeof DeviceOrientationEvent !== 'undefined' &&
  typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';

export async function requestCompass(): Promise<boolean> {
  if (!compassNeedsTap) return true;
  try {
    const res = await (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function listenCompass(declination: number, onHeading: (deg: number) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  let smooth: number | null = null;
  const push = (raw: number) => {
    const d = (((raw + declination) % 360) + 360) % 360;
    if (smooth === null) smooth = d;
    else {
      const delta = ((((d - smooth) % 360) + 540) % 360) - 180;
      smooth = (smooth + delta * 0.2 + 360) % 360;
    }
    onHeading(smooth);
  };
  const ios = (e: DeviceOrientationEvent) => {
    const h = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    if (Number.isFinite(h)) push(h!);
  };
  const abs = (e: DeviceOrientationEvent) => {
    if (Number.isFinite(e.alpha)) push(360 - e.alpha!);
  };
  addEventListener('deviceorientation', ios);
  addEventListener('deviceorientationabsolute', abs as EventListener);
  return () => {
    removeEventListener('deviceorientation', ios);
    removeEventListener('deviceorientationabsolute', abs as EventListener);
  };
}
