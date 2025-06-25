import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      'stream': 'streamx',
      'path': 'path-browserify'
    }
  },
  define: {
    'process.platform': '"browser"',
    'process.env.NODE_DEBUG': 'undefined'
  }
})
