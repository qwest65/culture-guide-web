/**
 * Настройки, которые помнит телефон. localStorage может быть недоступен
 * (частный режим, встроенные браузеры) — тогда просто ничего не запоминаем.
 */
const PREFIX = 'cg.';

export function load(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    /* не страшно */
  }
}
