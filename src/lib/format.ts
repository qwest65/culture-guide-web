/** Форматирование для интерфейса и озвучки (русский язык). */

/** 1 объект, 2 объекта, 5 объектов. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const countOf = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

/** 7 м · 230 м · 1,2 км */
export function formatDistance(m: number): string {
  if (m < 10) return `${Math.round(m)} м`;
  if (m < 1000) return `${Math.round(m / 10) * 10} м`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} км`;
}

/** 45 мин · 1 ч · 1 ч 30 мин */
export function formatDuration(min: number): string {
  const total = Math.round(min);
  if (total < 60) return `${total} мин`;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${h} ч` : `${h} ч ${rest} мин`;
}

/** 1866 · май 1754 · 22 мая 1743 · 1908–1910 · XVIII век */
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

export function formatHistDate(d: string): string {
  if (/^[IVX]+$/.test(d)) return `${d} век`;
  const range = d.match(/^(\d{4})\/(\d{4})$/);
  if (range) return `${range[1]}–${range[2]}`;
  const full = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return `${Number(full[3])} ${MONTHS_GEN[Number(full[2]) - 1]} ${full[1]}`;
  const month = d.match(/^(\d{4})-(\d{2})$/);
  if (month) return `${MONTHS_NOM[Number(month[2]) - 1]} ${month[1]}`;
  return d;
}
