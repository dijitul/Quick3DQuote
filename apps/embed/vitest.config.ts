import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config for @q3dq/embed.
 *
 * - jsdom for any component tests (the state-machine test itself is pure,
 *   but we default to jsdom so component specs drop in without ceremony).
 * - Matches the `@/*` alias the app uses, pointed at src/.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/lib/**', 'src/components/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/app/embed.js/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
