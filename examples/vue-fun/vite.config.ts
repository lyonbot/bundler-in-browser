
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [
    vue(),
    vueJsx(),
    vueDevTools(),
  ],
  base: './',
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.platform': '"browser"',
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['monaco-editor-core']
  },
  resolve: {
    alias: {
      path: 'path-browserify',
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    }
  },
})
