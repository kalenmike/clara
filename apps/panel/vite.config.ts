import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The agent only accepts mutations from its own origin, so the dev proxy must
// present both Host and Origin as the panel listener rather than the Vite one.
const PANEL_API = 'http://127.0.0.1:8790'

const claraExcluded = ['0', 'false', 'off'].includes(
  (process.env.VITE_CLARA_MANAGEMENT ?? '').toLowerCase()
)
const claraStub = fileURLToPath(new URL('./src/features/clara/stub', import.meta.url))
const claraStubs: Record<string, string> = {
  flag: 'flag.ts',
  'management-card': 'management-card.tsx',
}

function claraStubPlugin(): Plugin {
  return {
    name: 'clara-management-stub',
    enforce: 'pre',
    resolveId(source) {
      const name = (source.split('/').pop() ?? '').replace(/\.(ts|tsx)$/, '')
      if (source.includes('features/clara/') && claraStubs[name]) {
        return join(claraStub, claraStubs[name])
      }
      return undefined
    },
  }
}

export default defineConfig({
  plugins: [...(claraExcluded ? [claraStubPlugin()] : []), react(), tailwindcss()],
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
