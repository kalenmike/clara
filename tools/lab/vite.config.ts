import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The lab server owns the orchestrator token and enforces its own origin, so
// the dev proxy presents the lab listener as both Host and Origin.
const LAB_API = 'http://127.0.0.1:8791'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': {
        target: LAB_API,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request) => request.setHeader('origin', LAB_API))
        },
      },
    },
  },
  preview: {
    port: 4175,
    strictPort: true,
  },
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
})
