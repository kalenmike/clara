import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

const commit = git(['rev-parse', '--short=8', 'HEAD']) ?? null
const dirty = Boolean(git(['status', '--porcelain']))
const builtAt = new Date().toISOString()

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Clara',
        short_name: 'Clara',
        description: 'A secure web client for your coding harness.',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      strategies: 'injectManifest',
      // The plugin locates the custom worker as `<srcDir>/<filename>`.
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      // Registration lives in src/features/pwa so the banner owns the lifecycle.
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // A classic worker keeps `importScripts` available and avoids module
        // service worker support gaps on iOS.
        rollupFormat: 'iife',
      },
    }),
  ],
  define: {
    'import.meta.env.CLARA_VERSION': JSON.stringify(packageVersion),
    'import.meta.env.CLARA_BUILD': JSON.stringify({
      mode: command === 'serve' ? 'dev' : 'build',
      commit,
      dirty,
      builtAt,
    }),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Docs are content only; editing them should not trigger a browser reload.
      ignored: ['**/docs/**'],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
}))
