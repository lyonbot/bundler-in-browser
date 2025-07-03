import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths'
import { commonResolveAliases } from '@bundler-in-browser/common/resolve-aliases';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);


export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            ...commonResolveAliases,
            'path': require.resolve('./test/__patch__/path.mjs'),  // <------
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
          include: ['test/**/*.test.ts'],
          exclude: ['test/e2e/**/*.test.ts'],
        }
      }
    ]
  },
});