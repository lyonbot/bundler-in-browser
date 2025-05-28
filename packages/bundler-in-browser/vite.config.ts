import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

import { commonResolveAliases } from '@bundler-in-browser/common/resolve-aliases.js';
import packageJSON from './package.json' assert { type: 'json' };

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': '"development"',
    // 'process.platform': '"browser"',
  },
  resolve: {
    alias: {
      ...commonResolveAliases,
      'stream': 'streamx',
    }
  },
  plugins: [dts({ rollupTypes: true })],
  build: {
    minify: !IS_DEVELOPMENT,
    rollupOptions: {
      external: [
        ...Object.keys(packageJSON.dependencies || {}),
        ...Object.keys(packageJSON.peerDependencies || {}),
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