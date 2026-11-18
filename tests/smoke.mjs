/**
 * Smoke-тест в настоящем браузере: собранный сайт (dist/) открывается на «телефоне»,
 * проходятся основные экраны, в консоли нет ошибок.
 *   npm run build && npm run smoke
 * Снимки экранов — в test-results/.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const PORT = 4173;
const ROOT = `http://localhost:${PORT}/`;
// Обычный сезон — чтобы тесты не зависели от даты; зима проверяется отдельно (?winter=1).
const BASE = `${ROOT}?winter=0`;
const TROITSK = { latitude: 54.0826, longitude: 61.5592 };

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const stop = () => server.kill('SIGTERM');

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(ROOT)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('vite preview не запустился');
}

const steps = [];
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  console.log(`  ✓ ${name}`);
};

let browser;
try {
  await waitForServer();
  mkdirSync('test-results', { recursive: true });
  browser = await chromium.launch({
    // WebGL для карты в headless-браузере — программный (SwiftShader).
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    locale: 'ru-RU',
    geolocation: TROITSK,
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`page: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  await step('главная: сразу путеводитель по Троицку', async () => {
    await page.goto(BASE);
    await page.getByRole('heading', { level: 1, name: 'Троицк' }).waitFor();
    await page.getByRole('button', { name: /Начать прогулку/ }).waitFor();
    if ((await page.locator('.route-card').count()) !== 5) throw new Error('не 5 маршрутов');
    if ((await page.locator('.tile').count()) !== 14) throw new Error('не 14 мест');
    await page.screenshot({ path: 'test-results/01-home.png' });
    await page.locator('.places-map').scrollIntoViewIfNeeded();
    await page.locator('.places-map .maplibregl-canvas').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/02-home-full.png', fullPage: true });
  });

  await step('маршрут: остановки по порядку', async () => {
    await page.locator('.route-card-link', { hasText: 'Исторический центр' }).click();
    await page.getByRole('heading', { level: 1, name: 'Исторический центр' }).waitFor();
    const stops = await page.locator('.stops > li').count();
    if (stops !== 7) throw new Error(`остановок ${stops}, ожидалось 7`);
    const first = await page.locator('.stops > li').first().innerText();
    if (!first.includes('Памятный камень')) throw new Error(`первая остановка: ${first}`);
    await page.screenshot({ path: 'test-results/03-route.png', fullPage: true });
  });

  await step('карточка объекта: рассказ, даты, люди, источники', async () => {
    await page.locator('a.stop', { hasText: 'Пассаж братьев Яушевых' }).click();
    await page.getByRole('heading', { level: 1, name: 'Пассаж братьев Яушевых' }).waitFor();
    for (const text of ['1908–1910', 'федерального значения', 'Источники', 'Исторический центр', 'Слушать рассказ']) {
      if (!(await page.getByText(text).first().isVisible())) throw new Error(`нет «${text}»`);
    }
    await page.screenshot({ path: 'test-results/04-place.png', fullPage: true });
  });

  await step('было и стало: ползунок и старый снимок', async () => {
    await page.getByRole('heading', { name: 'Было и стало' }).waitFor();
    const then = page.locator('.tn-then');
    await then.waitFor();
    if (!(await then.evaluate((img) => img.complete && img.naturalWidth > 0))) throw new Error('архивный снимок не загрузился');
    await page.getByRole('button', { name: /Совместить с камерой/ }).waitFor();
    await page.locator('.thennow').screenshot({ path: 'test-results/04b-thennow.png' });
  });

  await step('рассказ объекта играет по кнопке', async () => {
    await page.getByRole('button', { name: /Слушать рассказ/ }).click();
    await page.getByRole('button', { name: /Остановить/ }).waitFor();
    await page.getByRole('button', { name: /Остановить/ }).click();
  });

  await step('прогулка: карта, путь по улицам, прибытие через 5 секунд у точки', async () => {
    const stone = { latitude: 54.077456, longitude: 61.556294 };
    const away = { latitude: 54.0782, longitude: 61.5552 }; // ~110 м от камня
    await context.setGeolocation(away);
    let tiles = 0;
    let sprite = 0;
    page.on('response', (r) => {
      if (r.url().includes('/map/troitsk/tiles/') && r.ok()) tiles++;
      if (r.url().includes('/map/troitsk/sprites/') && r.ok()) sprite++;
    });
    await page.goto(`${BASE}#/troitsk`);
    // «Начать» прямо на карточке маршрута — прогулка стартует без второй кнопки.
    await page.locator('.route-card', { hasText: 'Исторический центр' }).getByRole('button', { name: /Начать/ }).click();
    await page.locator('.walk .maplibregl-canvas').waitFor({ timeout: 15000 });
    await page.getByText('Точка 1 из 7').waitFor();
    // Путь «от меня» по улицам строится, на плашке — расстояние.
    await page.locator('.walk-banner', { hasText: /м/ }).waitFor({ timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/06-walk.png' });
    if (tiles < 4) throw new Error(`кусочки своей карты не загрузились (${tiles})`);
    if (sprite === 0) throw new Error('значки карты не загрузились');
    // Подошли к точке: прибытие — только после 5 секунд в радиусе.
    await context.setGeolocation(stone);
    await page.waitForTimeout(2000);
    if (await page.getByText('Вы на месте').isVisible()) throw new Error('прибытие раньше 5 секунд');
    await page.getByText('Вы на месте').waitFor({ timeout: 10000 });
    await page.getByRole('heading', { name: 'Памятный камень Троицкой крепости' }).waitFor();
    const src = await page.evaluate(() => [...document.querySelectorAll('audio')].length);
    await page.screenshot({ path: 'test-results/07-arrived.png' });
    await page.getByRole('button', { name: 'Идём дальше' }).click();
    await page.getByText('Точка 2 из 7').waitFor();
    void src;
  });

  await step('«Я на месте» без геопозиции и сохранение прогресса', async () => {
    await page.getByRole('button', { name: 'Я на месте' }).click();
    await page.getByRole('heading', { name: 'Свято-Троицкий собор' }).waitFor();
    await page.getByRole('button', { name: 'Идём дальше' }).click();
    await page.goto(`${BASE}#/troitsk/route/istoricheskiy-tsentr`);
    await page.getByRole('button', { name: /Продолжить прогулку · место 3/ }).waitFor();
  });

  await step('открытка из Троицка собирается (обычный сезон и праздники)', async () => {
    await page.goto(`${ROOT}?winter=1#/troitsk`);
    await page.getByRole('link', { name: /Новогодняя открытка/ }).first().waitFor();
    await page.goto(`${BASE}#/troitsk`);
    await page.getByRole('link', { name: /Открытка из Троицка/ }).first().click();
    await page.getByRole('radio', { name: 'Привѣтъ изъ Троицка!' }).waitFor();
    await page.locator('.pc-preview.ready').waitFor({ timeout: 15000 });
    await page.getByPlaceholder('Дорогой маме').fill('Дорогой маме');
    await page.waitForTimeout(400);
    const filled = await page.locator('.pc-preview canvas').evaluate((c) => {
      const d = c.getContext('2d').getImageData(c.width / 2 - 50, 300, 100, 100).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
      return sum / (d.length / 4);
    });
    if (!(filled > 20 && filled < 250)) throw new Error(`фото на открытке не нарисовалось (${filled})`);
    await page.getByRole('button', { name: /Отправить открытку/ }).first().waitFor();
    await page.locator('.pc-preview').screenshot({ path: 'test-results/09-postcard.png' });
  });

  await step('крупный шрифт включается и запоминается', async () => {
    const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const before = await size();
    await page.getByRole('button', { name: 'Крупный шрифт' }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('large-text'));
    if (!((await size()) > before)) throw new Error('шрифт не увеличился');
    await page.reload();
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (!((await size()) > before)) throw new Error('настройка не запомнилась');
    await page.screenshot({ path: 'test-results/05-large.png' });
  });

  await step('прямая ссылка на объект и несуществующий адрес', async () => {
    await page.goto(`${BASE}#/troitsk/place/gostinitsa-tsentralnaya`);
    await page.getByRole('heading', { level: 1, name: 'Гостиница «Центральная»' }).waitFor();
    await page.goto(`${BASE}#/troitsk/place/net-takogo`);
    await page.getByRole('heading', { level: 1, name: 'Такой страницы нет' }).waitFor();
  });

  await step('нет горизонтальной прокрутки', async () => {
    await page.goto(`${BASE}#/troitsk`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) throw new Error(`страница шире экрана на ${overflow}px`);
  });

  if (problems.length) throw new Error(`Ошибки в браузере:\n${problems.join('\n')}`);
  console.log(`Smoke-тест пройден: ${steps.length} проверок.`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
