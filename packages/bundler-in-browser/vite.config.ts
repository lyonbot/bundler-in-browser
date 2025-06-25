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
  plugins: [
    dts({ rollupTypes: true }),
    {
      name: 'worker-patch-maker',
      async load(id) {
        if (id.includes('?built')) {
          const esbuild = await import('esbuild')
          const path = id.replace(/\?.*/, '')
          const out = await esbuild.build({
            entryPoints: [path],
            write: false,
            bundle: true,
            format: 'iife',
          })

          this.addWatchFile(path)
          return {
            code: 'export default ' + JSON.stringify(out.outputFiles[0].text),
          }
        }
      },
    }
  ],
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
      entry: {
        index: './src/index.ts',
      },
      formats: ['cjs', 'es'],
      name: 'BundlerInBrowser'
    }
  },
})