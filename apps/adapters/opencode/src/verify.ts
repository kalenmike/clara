import type {
  AdapterVerifyCheck,
  AdapterVerifyOptions,
  AdapterVerifyReport,
} from '@clara/adapter-runtime'
import type { AdapterConfig } from './config.ts'
import { OpenCodeGateway } from './opencode.ts'

/**
 * Check the paired adapter against the running OpenCode server. The default
 * run is read-only; `--write` creates and removes one scratch session to prove
 * Clara-created sessions land in the native store.
 */
export async function verifyOpenCode(
  config: AdapterConfig,
  options: AdapterVerifyOptions
): Promise<AdapterVerifyReport> {
  const gateway = new OpenCodeGateway({
    url: config.opencode.url,
    username: config.opencode.username,
    ...(config.opencode.password ? { password: config.opencode.password } : {}),
  })
  const checks: AdapterVerifyCheck[] = []
  const directory = options.directory ?? process.cwd()

  const probe = await gateway.probe(3_000)
  checks.push({
    name: 'probe',
    status: probe.ok ? 'ok' : 'fail',
    detail: probe.ok
      ? `OpenCode ${probe.version ?? 'unknown'} answered in ${probe.latencyMs}ms`
      : (probe.message ?? probe.code),
    data: {
      code: probe.code,
      latencyMs: probe.latencyMs,
      ...(probe.version ? { version: probe.version } : {}),
    },
  })
  if (!probe.ok) return report(probe.version, checks)

  try {
    const [models, agents, commands, skills] = await Promise.all([
      gateway.client.model.list({ location: { directory } }),
      gateway.client.agent.list({ location: { directory } }),
      gateway.client.command.list({ location: { directory } }),
      gateway.client.skill.list({ location: { directory } }),
    ])
    checks.push({
      name: 'catalog',
      status: 'ok',
      detail: `${models.data.length} models, ${agents.data.length} agents, ${commands.data.length} commands, ${skills.data.length} skills`,
      data: {
        models: models.data.length,
        agents: agents.data.length,
        commands: commands.data.length,
        skills: skills.data.length,
      },
    })
  } catch (cause) {
    checks.push({ name: 'catalog', status: 'fail', detail: messageOf(cause) })
  }

  try {
    const sessions = await gateway.client.session.list({ directory })
    checks.push({
      name: 'sessions',
      status: sessions.data.length > 0 ? 'ok' : 'skip',
      detail:
        sessions.data.length > 0
          ? `${sessions.data.length} native sessions in ${directory}`
          : `no native sessions in ${directory}`,
      data: { sessionIDs: sessions.data.slice(0, 3).map((session) => session.id) },
    })
    const first = sessions.data[0]
    if (!first) {
      checks.push({ name: 'history', status: 'skip', detail: 'no native session to read' })
    } else {
      const messages = await gateway.client.message.list({
        sessionID: first.id,
        limit: 20,
      })
      checks.push({
        name: 'history',
        status: 'ok',
        detail: `read ${messages.data.length} messages from ${first.id}`,
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
    await roundTrip(gateway, directory, checks)
  }

  return report(probe.version, checks)
}

async function roundTrip(
  gateway: OpenCodeGateway,
  directory: string,
  checks: AdapterVerifyCheck[]
): Promise<void> {
  let sessionID: string | undefined
  try {
    const created = await gateway.client.session.create({ location: { directory } })
    sessionID = created.id
    const listed = await gateway.client.session.list({ directory })
    const found = listed.data.some((session) => session.id === created.id)
    checks.push({
      name: 'round-trip',
      status: found ? 'ok' : 'fail',
      detail: found
        ? `created ${created.id}; the native session list returns it`
        : `created ${created.id}; the native session list does not return it`,
    })
  } catch (cause) {
    checks.push({ name: 'round-trip', status: 'fail', detail: messageOf(cause) })
  } finally {
    if (sessionID) {
      try {
        await gateway.client.session.remove({ sessionID })
        checks.push({ name: 'cleanup', status: 'ok', detail: `removed ${sessionID}` })
      } catch (cause) {
        checks.push({ name: 'cleanup', status: 'fail', detail: messageOf(cause) })
      }
    }
  }
}

function report(version: string | undefined, checks: AdapterVerifyCheck[]): AdapterVerifyReport {
  return {
    adapter: 'opencode',
    label: 'OpenCode',
    ...(version ? { harness: `OpenCode ${version}` } : {}),
    checks,
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
