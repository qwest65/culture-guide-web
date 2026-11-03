import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Относительные пути: сайт работает и в корне домена, и в подпапке.
  base: './',
  plugins: [preact()],
  build: {
    target: ['es2020', 'safari15'],
    assetsInlineLimit: 0,
  },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
