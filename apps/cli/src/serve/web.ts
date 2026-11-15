import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installShutdownHandlers } from '@clara/service-control'
import { resolvePorts } from '../ports.ts'
import { startStaticServer } from './static.ts'

/**
 * Serve the web client. A packaged binary sets `CLARA_WEB_ASSETS_DIR`; a source
 * checkout falls back to `apps/web/dist`.
 */
export async function serveWeb(): Promise<void> {
  const root = webAssetsRoot()
  if (!root) {
    console.error('The web client is not built. Run `pnpm --filter @clara/web build` first.')
    process.exitCode = 1
    return
  }
  const ports = resolvePorts()
  const server = await startStaticServer({ root, port: ports.web })
  console.log(`[clara-web] serving ${root}`)
  console.log(`[clara-web] listening on ${server.url}`)
  installShutdownHandlers({ label: 'clara-web', close: () => server.close() })
}

export function webAssetsRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.CLARA_WEB_ASSETS_DIR?.trim()
  if (configured)
    return existsSync(join(configured, 'index.html')) ? resolve(configured) : undefined
  const here = dirname(fileURLToPath(import.meta.url))
  const candidate = resolve(here, '..', '..', '..', 'web', 'dist')
  return existsSync(join(candidate, 'index.html')) ? candidate : undefined
}
