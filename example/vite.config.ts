import { createRequire } from 'module';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    'process.env.NODE_ENV': '"development"',
    'process.platform': '"browser"',
  },
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      path: 'path-browserify',
    }
  },
})
