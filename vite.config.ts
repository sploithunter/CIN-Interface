import { defineConfig } from 'vite'
import { resolve } from 'path'
import { DEFAULTS } from './shared/defaults'

const clientPort = parseInt(process.env.VIBECRAFT_CLIENT_PORT ?? String(DEFAULTS.CLIENT_PORT), 10)
const serverPort = parseInt(process.env.VIBECRAFT_PORT ?? String(DEFAULTS.SERVER_PORT), 10)

export default defineConfig({
  root: 'frontend',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'frontend'),
      '@shared': resolve(__dirname, 'frontend/shared'),
    },
  },
  define: {
    // Inject default port into frontend at build time
    __VIBECRAFT_DEFAULT_PORT__: serverPort,
  },
  server: {
    port: clientPort,
    fs: {
      // Allow serving files from shared/ outside the root
      allow: ['..'],
    },
    proxy: {
      '/ws': {
        target: `ws://localhost:${serverPort}`,
        ws: true,
      },
      '/api': {
        target: `http://localhost:${serverPort}`,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    target: 'esnext',
    sourcemap: true,
    outDir: '../dist',
    emptyDir: false,  // Don't wipe server build
  },
})
