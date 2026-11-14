import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AdapterVerifyCheck,
  AdapterVerifyOptions,
  AdapterVerifyReport,
} from '@clara/adapter-runtime'
import type { AdapterConfig } from './config.ts'
import { AgentSdkGateway, type ClaudeTurn } from './sdk.ts'
import { SessionService } from './sessions.ts'
import { SessionStore } from './store.ts'
import { claudeProjectsDirectory, findTranscript } from './transcript.ts'

/**
 * Check the paired adapter against the Claude Code installation and the native
 * transcript store. The default run is read-only; `--write` creates a scratch
 * session, proves Claude wrote a native transcript, then removes it.
 */
export async function verifyClaude(
  config: AdapterConfig,
  options: AdapterVerifyOptions
): Promise<AdapterVerifyReport> {
  const claude = new AgentSdkGateway(config.claude)
  const checks: AdapterVerifyCheck[] = []
  const directory = options.directory ?? process.cwd()

  const probe = await claude.probe(3_000)
  checks.push({
    name: 'probe',
    status: probe.ok ? 'ok' : 'fail',
    detail: probe.ok
      ? `Claude Code ${probe.version ?? 'unknown'} answered in ${probe.latencyMs}ms`
      : (probe.message ?? probe.code),
    data: {
      code: probe.code,
      latencyMs: probe.latencyMs,
      ...(probe.version ? { version: probe.version } : {}),
    },
  })
  if (!probe.ok) return report(probe.version, checks)

  const auth = await claude.auth()
  checks.push({
    name: 'auth',
    status: auth?.loggedIn === false ? 'fail' : 'ok',
    detail:
      auth?.loggedIn === false
        ? 'Claude Code is not signed in on this machine'
        : auth?.authMethod
          ? `signed in with ${auth.authMethod}`
          : 'signed in',
  })

  try {
    const catalog = await claude.catalog(directory)
    checks.push({
      name: 'catalog',
      status: 'ok',
      detail: `${catalog.models.length} models, ${catalog.agents.length} subagents, ${catalog.commands.length} commands, ${catalog.skills.length} skills, ${catalog.plugins.length} plugins`,
      data: {
        models: catalog.models.length,
        subagents: catalog.agents.length,
        commands: catalog.commands.length,
        skills: catalog.skills.length,
        plugins: catalog.plugins.map((plugin) => plugin.name),
      },
    })
  } catch (cause) {
    checks.push({ name: 'catalog', status: 'fail', detail: messageOf(cause) })
  }

  try {
    const sessions = await claude.listSessions({ directory })
    checks.push({
      name: 'sessions',
      status: sessions.length > 0 ? 'ok' : 'skip',
      detail:
        sessions.length > 0
          ? `${sessions.length} native sessions in ${directory}`
          : `no native sessions in ${directory}`,
      data: { sessionIDs: sessions.slice(0, 3).map((session) => session.sessionId) },
    })
    const first = sessions[0]
    if (!first) {
      checks.push({ name: 'history', status: 'skip', detail: 'no native session to read' })
    } else {
      const messages = await claude.getSessionMessages(first.sessionId, { directory, limit: 20 })
      checks.push({
        name: 'history',
        status: 'ok',
        detail: `read ${messages.length} messages from ${first.sessionId}`,
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
    await roundTrip(claude, directory, auth?.projectsDirectory, checks)
  }

  return report(probe.version, checks)
}

async function roundTrip(
  claude: AgentSdkGateway,
  directory: string,
  projectsDirectory: string | undefined,
  checks: AdapterVerifyCheck[]
): Promise<void> {
  const storeDirectory = mkdtempSync(join(tmpdir(), 'clara-claude-verify-'))
  const sessions = new SessionService(
    claude,
    new SessionStore(join(storeDirectory, 'catalog.json')),
    'verify',
    () => {}
  )
  let sessionID: string | undefined
  let turn: ClaudeTurn | undefined
  try {
    const created = await sessions.create({ location: { directory } })
    sessionID = created.id
    let settled = false
    let finish: (error?: Error) => void = () => {}
    const timer = setTimeout(
      () => finish(new Error('Claude did not finish the verification turn')),
      30_000
    )
    const done = new Promise<void>((resolve, reject) => {
      finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
    })
    try {
      turn = await claude.startTurn({
        sessionId: created.id,
        directory,
        text: 'Clara adapter verification',
        synthetic: true,
        signal: AbortSignal.timeout(30_000),
        onEvent: (event) => {
          if (event.type === 'result') finish()
          else if (event.type === 'error' && event.fatal) finish(new Error(event.message))
        },
        onPermission: async () => ({ behavior: 'deny', message: 'Verification is read-only' }),
      })
      await done
    } finally {
      clearTimeout(timer)
    }
    const path = findTranscript(claudeProjectsDirectory(projectsDirectory), directory, sessionID)
    checks.push({
      name: 'round-trip',
      status: path ? 'ok' : 'fail',
      detail: path
        ? `created ${sessionID}; Claude wrote a native transcript`
        : `created ${sessionID}; Claude wrote no transcript`,
    })
  } catch (cause) {
    checks.push({ name: 'round-trip', status: 'fail', detail: messageOf(cause) })
  } finally {
    turn?.close()
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
    adapter: 'claude',
    label: 'Claude Code',
    ...(version ? { harness: `Claude Code ${version}` } : {}),
    checks,
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
