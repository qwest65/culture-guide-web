import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Относительные пути: сайт работает и в корне домена, и в подпапке.
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  build: {
    target: ['es2020', 'safari15'],
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Фоновый скрипт карты (maplibre-gl-worker.mjs) — с расширением .js: тип .mjs знают
        // не все серверы (nginx по умолчанию отдаёт его как двоичный файл, и карта не рисуется).
        assetFileNames: (asset) =>
          asset.names?.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
