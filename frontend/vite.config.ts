import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: '.',
  build: {
    outDir: '../dist',
    emptyOutDir: false, // Don't delete server files
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4003',
      '/ws': {
        target: 'ws://localhost:4003',
        ws: true,
      },
    },
  },
})
