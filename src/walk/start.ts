import { href } from '../router';
import { player } from './player';

const KEY = 'cg.autostart';

/**
 * «Начать прогулку» с любой страницы: звук разблокируется этим же нажатием (iPhone),
 * а экран прогулки стартует сам — без второй кнопки.
 */
export function startWalk(city: string, route: string): void {
  player.unlock();
  try {
    sessionStorage.setItem(KEY, `${city}/${route}`);
  } catch {
    /* без sessionStorage — на экране прогулки будет кнопка «Начать» */
  }
  location.hash = href.walk(city, route);
}

/** Пришли по кнопке «Начать прогулку» — стартовать сразу. */
export function takeAutostart(city: string, route: string): boolean {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v === `${city}/${route}`;
  } catch {
    return false;
  }
}
