import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { PROTOCOL_VERSION } from '@clara/shared-types/protocol'
import { featureEnabled } from '../../tools/build/feature-flags.mjs'
import { buildVersion } from '../../tools/build/version.mjs'

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
const healthVersion = buildVersion({
  packageVersion,
  commit: process.env.CLARA_COMMIT?.trim().slice(0, 7) || git(['rev-parse', '--short=7', 'HEAD']),
})

// The identity a page and its service worker compare before offering an update.
// A clean checkout is identified by its commit, so rebuilding the same code does
// not look like a new version; a dirty tree or a checkout without git can differ
// between builds, so it is identified by its build time. The values are compiled
// into both the app and the worker (a separate Vite build without
// `vite-env.d.ts`), so they are bare globals.
const buildId = commit ? (dirty ? `${commit}+${builtAt}` : commit) : builtAt
const buildIdentityDefine = {
  __CLARA_BUILD_ID__: JSON.stringify(buildId),
  __CLARA_BUILD_AT__: JSON.stringify(builtAt),
}

/**
 * Publish the health response as a file next to the app. The static hosts
 * (nginx, the packaged command, Pages) serve it at `/healthz`, so a probe sees
 * the version and protocol of the assets that are actually deployed, not the
 * ones the command assumes are installed.
 */
function healthFile(version: string): Plugin {
  return {
    name: 'clara-health',
    apply: 'build',
    buildStart() {
      this.emitFile({
        type: 'asset',
        fileName: 'healthz',
        source: JSON.stringify({
          ok: true,
          service: 'clara-web',
          version,
          protocol: PROTOCOL_VERSION,
        }),
      })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  // The desktop shell bundles the same app without the service worker, into its
  // own directory so a Tauri build can never leak into the deployed web build.
  const desktop = mode === 'desktop'

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(desktop
        ? []
        : [
            healthFile(healthVersion),
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
          ]),
    ],
    define: {
      'import.meta.env.CLARA_VERSION': JSON.stringify(packageVersion),
      'import.meta.env.CLARA_DESKTOP': JSON.stringify(desktop),
      'import.meta.env.CLARA_BUILD': JSON.stringify({
        mode: command === 'serve' ? 'dev' : 'build',
        surface: desktop ? 'desktop' : 'web',
        commit,
        dirty,
        builtAt,
      }),
      // The `/hub` route compiles the shared panel UI into this app. Its
      // Cloudflare relay deployment screen is a build-time feature, so the flag
      // follows the served panel's config rather than a runtime setting.
      __CLARA_CLOUDFLARE_DEPLOYMENT__: JSON.stringify(
        featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)
      ),
      // The same identity is compiled into the app and into the service worker
      // build, which lets them compare versions over a message.
      ...buildIdentityDefine,
    },
    build: {
      outDir: desktop ? 'dist-desktop' : 'dist',
      rollupOptions: {
        output: {
          // Routes split into their own chunks (see `src/router.tsx`), and the
          // rest is left to Rolldown's automatic chunking. The one group worth
          // forcing is the framework: React and the router change far less often
          // than the app, so keeping them in a stable chunk means an installed
          // PWA re-downloads app code on update, not the 300 kB runtime.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (/\/node_modules\/(\.pnpm\/)?(react|react-dom|scheduler|react-router)@/.test(id)) {
              return 'vendor-react'
            }
            return undefined
          },
        },
      },
    },
    resolve: {
      alias: {
        // The lab is a desktop-only surface. Replace its modules with stubs in
        // the web build so no lab code can reach the deployed artifact, even if
        // a future refactor keeps the route import in the module graph.
        ...(desktop
          ? {}
          : {
              '@clara/lab/styles.css': fileURLToPath(
                new URL('./src/lib/lab-absent.css', import.meta.url)
              ),
              '@clara/lab': fileURLToPath(new URL('./src/lib/lab-absent.ts', import.meta.url)),
              '@/pages/lab-page': fileURLToPath(
                new URL('./src/lib/lab-absent-page.tsx', import.meta.url)
              ),
            }),
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
  }
})
