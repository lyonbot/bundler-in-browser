import { createRequire } from 'module';
import { defineConfig } from 'vite'
const require = createRequire(import.meta.url);

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      'path': 'path-browserify',
      'stream': 'streamx',
      'fs': require.resolve('./src/dirty-stuff/empty-object.cjs'),
      'graceful-fs': require.resolve('./src/dirty-stuff/empty-object.cjs'),
    }
  }
})