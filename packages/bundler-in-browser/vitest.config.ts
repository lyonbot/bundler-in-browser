import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // setupFiles: ['./test/setup.ts'],
    alias: [
      { find: /^bundler-in-browser$/, replacement: path.resolve(__dirname, './src/index.ts') }
    ]
  },
});