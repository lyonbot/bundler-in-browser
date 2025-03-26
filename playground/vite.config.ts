import { createRequire } from 'module';
import { defineConfig } from 'vite'

const require = createRequire(import.meta.url);

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
    // 'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      'path': 'path-browserify',
      'util': require.resolve('./src/polyfill/util.js'),
    }
  },
})