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
      'stream': 'streamx',
      assert: require.resolve('assert'),
      buffer: require.resolve('buffer'),
      path: require.resolve('path-browserify'),
      process: require.resolve('process/browser'),
      url: require.resolve('url'),
      util: require.resolve('util'),
    }
  },
})
