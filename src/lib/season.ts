/**
 * Сезоны оформления. Зима (новогодняя открытка, снег на обложке, короткий зимний маршрут) —
 * с 15 ноября по 14 января. Для проверки: ?winter=1 или ?winter=0 в адресе.
 */
export function isWinter(d: Date = new Date()): boolean {
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('winter');
    if (q === '1') return true;
    if (q === '0') return false;
  }
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return (m === 11 && day >= 15) || m === 12 || (m === 1 && day <= 14);
}

/** Какой Новый год поздравляем: в ноябре–декабре — следующий. */
export function newYear(d: Date = new Date()): number {
  return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear();
}
