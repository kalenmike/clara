import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildVersion } from '../build/version.mjs'

// The lab server owns the orchestrator token and enforces its own origin, so
// the dev proxy presents the lab listener as both Host and Origin.
const LAB_API = 'http://127.0.0.1:8791'
const root = fileURLToPath(new URL('../..', import.meta.url))

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version

function git(args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return undefined
  }
}

const commit = process.env.CLARA_COMMIT?.trim() || git(['rev-parse', '--short=8', 'HEAD']) || null
const dirtyFromEnv = process.env.CLARA_DIRTY
const dirty =
  dirtyFromEnv === undefined
    ? Boolean(git(['status', '--porcelain']))
    : dirtyFromEnv === '1' || dirtyFromEnv === 'true'
const builtAt = new Date().toISOString()
const version = buildVersion({
  packageVersion,
  commit: process.env.CLARA_COMMIT?.trim().slice(0, 7) || git(['rev-parse', '--short=7', 'HEAD']),
})

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.CLARA_VERSION': JSON.stringify(version),
    'import.meta.env.CLARA_BUILD': JSON.stringify({
      mode: command === 'serve' ? 'dev' : 'build',
      commit,
      dirty,
      builtAt,
    }),
  },
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
}))
