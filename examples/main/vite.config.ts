
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'



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
