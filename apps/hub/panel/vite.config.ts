import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { featureEnabled } from '../../../tools/build/feature-flags.mjs'
import { buildVersion } from '../../../tools/build/version.mjs'

// The agent only accepts mutations from its own origin, so the dev proxy must
// present both Host and Origin as the panel listener rather than the Vite one.
const PANEL_API = 'http://127.0.0.1:8790'

const root = fileURLToPath(new URL('../../..', import.meta.url))

const packageVersion = (
  JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
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

// The Docker context excludes `.git`, so the CLI passes the host checkout's
// values as environment variables before the panel build.
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
}))
