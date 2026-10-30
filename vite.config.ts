import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

type LocalService = {
  url: string
  password?: string
  version?: string
}

/**
 * The background OpenCode service stores its URL and password in the XDG state
 * directory. The dev proxy uses them so the browser never has to hold the
 * password for the local service.
 */
function readLocalService(): LocalService | undefined {
  const stateHome = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state')
  try {
    const raw = readFileSync(join(stateHome, 'opencode', 'service.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LocalService>
    if (!parsed.url) return undefined
    return { url: parsed.url, password: parsed.password, version: parsed.version }
  } catch {
    return undefined
  }
}

const localService = readLocalService()

const proxy: Record<string, ProxyOptions> | undefined = localService
  ? {
      '/oc': {
        target: localService.url,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/oc/, ''),
        headers: localService.password
          ? {
              authorization: `Basic ${Buffer.from(`opencode:${localService.password}`).toString('base64')}`,
            }
          : undefined,
        // Server-sent events must not be buffered by the dev proxy.
        configure: (instance) => {
          instance.on('proxyReq', (request) => {
            request.setHeader('accept-encoding', 'identity')
          })
        },
      },
    }
  : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
})
