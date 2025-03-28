import { createRequire } from 'module';
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

import packageJSON from './package.json' assert { type: 'json' };
const require = createRequire(import.meta.url);
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
    // 'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      'path': require.resolve('./src/dirty-stuff/path.cjs'),
      'stream': 'streamx',
      'fs': require.resolve('./src/dirty-stuff/empty-object.cjs'),
      'graceful-fs': require.resolve('./src/dirty-stuff/empty-object.cjs'),
      'util': require.resolve('./src/dirty-stuff/util.js'),
    }
  },
  plugins: [dts({ rollupTypes: true })],
  build: {
    minify: !IS_DEVELOPMENT,
    rollupOptions: {
      external: [
        ...Object.keys(packageJSON.dependencies),
        ...Object.keys(packageJSON.peerDependencies),
        'vue/compiler-sfc',
      ]
    },
    lib: {
      entry: './src/index.ts',
      formats: ['cjs', 'es'],
      fileName: 'index',
      name: 'BundlerInBrowser'
    }
  }
})