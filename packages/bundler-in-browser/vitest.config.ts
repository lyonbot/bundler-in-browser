import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths'
import { commonResolveAliases } from '@bundler-in-browser/common/resolve-aliases';
import path from 'path';
import { fileURLToPath } from 'url';

const basedir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            ...commonResolveAliases,
            vue$: 'vue/dist/vue.esm-bundler.js',
            'path': path.resolve(basedir, './test/__patch__/path.mjs'),  // <------
            'stream': 'streamx',
          }
        },
        define: {
          '__IS_BROWSER__': 'true',
        },
        test: {
          name: { label: 'e2e' },
          globals: true,
          browser: {
            enabled: true,
            instances: [
              { browser: 'chromium' },
            ]
          },
          includeTaskLocation: true,
          include: ['test/e2e/**/*.test.ts'],
        }
      },
      {
        plugins: [tsconfigPaths()],
        define: {
          '__IS_BROWSER__': 'false',
        },
        test: {
          name: { label: 'unit' },
          environment: 'node',
          globals: true,
          includeTaskLocation: true,
          include: ['test/**/*.test.ts'],
          exclude: ['test/e2e/**/*.test.ts'],
        }
      }
    ]
  },
});