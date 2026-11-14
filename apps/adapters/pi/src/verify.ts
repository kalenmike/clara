import { realpathSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AdapterVerifyCheck,
  AdapterVerifyOptions,
  AdapterVerifyReport,
} from '@clara/adapter-runtime'
import type { AdapterConfig } from './config.ts'
import { sessionRoots } from './config.ts'
import { CatalogService } from './catalog.ts'
import { findPiBinary, piProcessEnv, probePi } from './discover.ts'
import { PiRpcClient, type PiState } from './pi/client.ts'
import { SessionIndex } from './pi/indexer.ts'
import { PromptMap } from './prompt-map.ts'
import { SessionService } from './sessions.ts'

/**
 * Check the paired adapter against the user's Pi installation and session
 * store. The default run is read-only; `--write` creates a scratch session,
 * opens it with the user's `pi` binary, then removes it.
 */
export async function verifyPi(
  config: AdapterConfig,
  options: AdapterVerifyOptions
): Promise<AdapterVerifyReport> {
  const checks: AdapterVerifyCheck[] = []
  const directory = options.directory ?? process.cwd()
  const binary = findPiBinary(config.pi.piPath)

  if (!binary) {
    checks.push({
      name: 'probe',
      status: 'fail',
      detail: 'Pi was not found on this machine',
    })
    return { adapter: 'pi', label: 'Pi', checks }
  }

  const probe = await probePi(config.pi, 3_000)
  checks.push({
    name: 'probe',
    status: probe.ok ? 'ok' : 'fail',
    detail: probe.ok
      ? `Pi ${probe.version ?? 'unknown'} answered in ${probe.latencyMs}ms`
      : (probe.message ?? probe.code),
    data: {
      code: probe.code,
      latencyMs: probe.latencyMs,
      ...(probe.version ? { version: probe.version } : {}),
    },
  })
  if (!probe.ok) return report(probe.version, checks)

  const catalog = new CatalogService(config.pi, binary)
  try {
    const [models, commands, skills] = await Promise.all([
      catalog.models(directory),
      catalog.commands(directory),
      catalog.skills(directory),
    ])
    checks.push({
      name: 'catalog',
      status: 'ok',
      detail: `${models.data.length} models, ${commands.data.length} commands, ${skills.data.length} skills`,
      data: {
        models: models.data.length,
        commands: commands.data.length,
        skills: skills.data.length,
      },
    })
  } catch (cause) {
    checks.push({ name: 'catalog', status: 'fail', detail: messageOf(cause) })
  } finally {
    catalog.invalidate()
  }

  const index = new SessionIndex(() => sessionRoots(config.pi))
  const target = canonical(directory)
  try {
    const sessions = (await index.list(sessionRoots(config.pi, directory))).filter(
      (session) => canonical(session.cwd) === target
    )
    checks.push({
      name: 'sessions',
      status: sessions.length > 0 ? 'ok' : 'skip',
      detail:
        sessions.length > 0
          ? `${sessions.length} native sessions in ${directory}`
          : `no native sessions in ${directory}`,
      data: { sessionIDs: sessions.slice(0, 3).map((session) => session.id) },
    })
    const first = sessions[0]
    if (!first) {
      checks.push({ name: 'history', status: 'skip', detail: 'no native session to read' })
    } else {
      const session = await index.read(first.path)
      checks.push({
        name: 'history',
        status: 'ok',
        detail: `read ${session.entries.length} entries from ${first.id}`,
      })
    }
  } catch (cause) {
    checks.push({ name: 'sessions', status: 'fail', detail: messageOf(cause) })
  }

  if (!options.write) {
    checks.push({
      name: 'round-trip',
      status: 'skip',
      detail: 'pass --write to create and remove a scratch session',
    })
  } else {
    await roundTrip(config, directory, binary, index, checks)
  }

  return report(probe.version, checks)
}

async function roundTrip(
  config: AdapterConfig,
  directory: string,
  binary: string,
  index: SessionIndex,
  checks: AdapterVerifyCheck[]
): Promise<void> {
  const storeDirectory = mkdtempSync(join(tmpdir(), 'clara-pi-verify-'))
  const sessions = new SessionService(
    config.pi,
    index,
    new PromptMap(join(storeDirectory, 'prompt-ids.json')),
    'verify',
    () => {}
  )
  let sessionID: string | undefined
  try {
    const created = await sessions.create({ location: { directory } })
    sessionID = created.id
    const target = await sessions.target(created.id)
    const client = await PiRpcClient.start({
      binary,
      cwd: directory,
      env: piProcessEnv(config.pi),
      sessionFile: target.path,
      trust: config.pi.trust ?? 'inherit',
    })
    try {
      const state = await client.request<PiState>({ type: 'get_state' })
      checks.push({
        name: 'round-trip',
        status: state.sessionId === created.id ? 'ok' : 'fail',
        detail:
          state.sessionId === created.id
            ? `created ${created.id}; Pi opened the same native session`
            : `created ${created.id}; Pi reported ${state.sessionId ?? 'no session id'}`,
      })
    } finally {
      await client.close(2_000)
    }
  } catch (cause) {
    checks.push({ name: 'round-trip', status: 'fail', detail: messageOf(cause) })
  } finally {
    if (sessionID) {
      try {
        await sessions.remove(sessionID)
        checks.push({ name: 'cleanup', status: 'ok', detail: `removed ${sessionID}` })
      } catch (cause) {
        checks.push({ name: 'cleanup', status: 'fail', detail: messageOf(cause) })
      }
    }
    rmSync(storeDirectory, { recursive: true, force: true })
  }
}

function report(version: string | undefined, checks: AdapterVerifyCheck[]): AdapterVerifyReport {
  return {
    adapter: 'pi',
    label: 'Pi',
    ...(version ? { harness: `Pi ${version}` } : {}),
    checks,
  }
}

function canonical(directory: string): string {
  try {
    return realpathSync(directory)
  } catch {
    return directory
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
