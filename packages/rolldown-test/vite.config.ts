import { defineConfig } from "vite";

export default defineConfig({
  // plugins: [
  //   topLevelAwait({
  //     promiseExportName: "__tla",
  //     promiseImportName: i => `__tla_${i}`
  //   })
  // ],
  base: './',
  build: {
    target: 'esnext',
    minify: false,
  },
  resolve: {
    alias: {
      rolldown: '@rolldown/browser',
      'node:path': 'path-browserify',
    }
  },
});