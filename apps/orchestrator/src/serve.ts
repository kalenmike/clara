import { unlinkSync, writeFileSync } from 'node:fs'
import { Runtime, Store } from '@clara/orchestration'
import {
  baseURL,
  configPath,
  dbPath,
  ensureToken,
  host,
  pidPath,
  port,
  workspace,
} from '@clara/service-control'
import { engineEnv } from './env.ts'
import { createEngineServer } from './server.ts'

function writePid(): void {
  writeFileSync(pidPath(), `${process.pid}\n`, { mode: 0o600 })
}

function removePid(): void {
  try {
    unlinkSync(pidPath())
  } catch {
    // Already gone.
  }
}

/**
 * Run the engine in the foreground until SIGINT or SIGTERM. The engine CLI and
 * the packaged `clara` binary both call this so there is one serve path.
 */
export async function serveEngine(): Promise<void> {
  const store = new Store(dbPath())
  const runtime = new Runtime({
    store,
    ...(configPath() ? { configPath: configPath() } : {}),
    stalledMs: Number(
      engineEnv('CLARA_ENGINE_STALLED_MS', 'CLARA_ORCHESTRATION_STALLED_MS') ?? 5 * 60_000
    ),
    leaseMs: Number(
      engineEnv('CLARA_ENGINE_LEASE_MS', 'CLARA_ORCHESTRATION_LEASE_MS') ?? 30 * 60_000
    ),
    runnerWaitMs: Number(process.env.CLARA_RUNNER_WAIT_MS ?? 60_000),
  })
  const token = ensureToken()
  const app = createEngineServer({
    runtime,
    token,
    host: host(),
    port: port(),
    workspace: workspace(),
    ...(configPath() ? { configPath: configPath() } : {}),
  })
  writePid()
  await new Promise<void>((resolve, reject) => {
    app.server.once('error', reject)
    app.server.listen(port(), host(), () => resolve())
  })
  console.log(`[clara-engine] listening on ${baseURL()}`)
  console.log(`[clara-engine] database ${dbPath()}`)
  console.log(`[clara-engine] workspace ${workspace()}`)
  console.log(
    `[clara-engine] token file ${engineEnv('CLARA_ENGINE_TOKEN_FILE', 'CLARA_ORCHESTRATION_TOKEN_FILE') ?? 'default'}`
  )
  console.log('[clara-engine] MCP endpoint /mcp, REST /v1, events /v1/events')
  const shutdown = async () => {
    console.log('[clara-engine] shutting down')
    await app.close()
    store.db.close()
    removePid()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}
