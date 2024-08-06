import { createRequire } from 'module';
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

import packageJSON from './package.json' assert { type: 'json' };
const require = createRequire(import.meta.url);

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
    // 'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      'path': 'path-browserify',
      'stream': 'streamx',
      'fs': require.resolve('./src/dirty-stuff/empty-object.cjs'),
      'graceful-fs': require.resolve('./src/dirty-stuff/empty-object.cjs'),
    }
  },
  plugins: [dts({ rollupTypes: true })],
  build: {
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