import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { featureEnabled } from '../../../tools/build/feature-flags.mjs'

// The agent only accepts mutations from its own origin, so the dev proxy must
// present both Host and Origin as the panel listener rather than the Vite one.
const PANEL_API = 'http://127.0.0.1:8790'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __CLARA_CLOUDFLARE_DEPLOYMENT__: JSON.stringify(
      featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)
    ),
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/panel/api': {
        target: PANEL_API,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request) => request.setHeader('origin', PANEL_API))
        },
      },
    },
  },
  preview: {
    port: 4174,
    strictPort: true,
  },
  build: {
    sourcemap: false,
  },
})
