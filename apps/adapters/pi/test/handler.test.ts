import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaraEvent } from '@clara/api-contract'
import { PI_CAPABILITIES } from '../src/capabilities.ts'
import type { PiConfig } from '../src/config.ts'
import { CatalogService } from '../src/catalog.ts'
import { EventBus } from '../src/events.ts'
import { createAdapterApp } from '../src/handler.ts'
import { probePi } from '../src/discover.ts'
import { SessionIndex } from '../src/pi/indexer.ts'
import { PromptMap } from '../src/prompt-map.ts'
import { PiRuntime } from '../src/runtime.ts'
import { SessionService } from '../src/sessions.ts'

const fake = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url))

afterEach(() => {
  delete process.env.FAKE_PI_UI
})

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clara-pi-handler-'))
  const project = join(root, 'project')
  mkdirSync(project)
  const config: PiConfig = {
    piPath: fake,
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
  }
  const events: ClaraEvent[] = []
  const bus = new EventBus()
  bus.subscribe((event) => events.push(event))
  const sessions = new SessionService(
    config,
    new SessionIndex(() => [join(root, 'sessions')]),
    new PromptMap(join(root, 'prompt-ids.json')),
    '0.1.0',
    (event) => bus.publish(event)
  )
  const runtime = new PiRuntime(config, fake, sessions, bus)
  const catalog = new CatalogService(config, fake)
  const probe = await probePi(config)
  const app = createAdapterApp({
    sessions,
    runtime,
    catalog,
    events: bus,
    probe: async () => probe,
    info: {
      adapter: { name: 'pi', version: '0.1.0' },
      harness: { kind: 'pi', version: probe.version ?? 'unknown' },
      capabilities: PI_CAPABILITIES,
    },
  })
  return { root, project, app, events, sessions, runtime }
}

describe('Pi adapter HTTP surface', () => {
  it('reports info and health', async () => {
    const { app, runtime } = await fixture()
    const info = await app.request('/harness/v1/info')
    expect(info.status).toBe(200)
    expect(await info.json()).toMatchObject({
      protocol: 1,
      adapter: { name: 'pi', version: '0.1.0' },
      harness: { kind: 'pi', version: '1.5.2' },
      capabilities: { sessions: { move: false } },
    })
    const health = await app.request('/harness/v1/health')
    expect(await health.json()).toMatchObject({ ok: true, code: 'ready' })
    await runtime.close()
  })

  it('creates, lists, prompts, and reads a session', async () => {
    const { app, project, events, runtime } = await fixture()
    const created = await app.request('/harness/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location: { directory: project }, title: 'API session' }),
    })
    expect(created.status).toBe(200)
    const session = (await created.json()) as { id: string; title: string }
    expect(session.title).toBe('API session')

    const list = await app.request('/harness/v1/sessions')
    expect(((await list.json()) as { data: unknown[] }).data).toHaveLength(1)

    const prompt = await app.request(`/harness/v1/sessions/${session.id}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    })
    expect(prompt.status).toBe(200)
    const inbox = (await prompt.json()) as { id: string }
    const started = Date.now()
    while (
      !events.some(
        (event) => event.type === 'session.idle' && event.data.sessionID === session.id
      ) &&
      Date.now() - started < 5_000
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    const messages = await app.request(`/harness/v1/sessions/${session.id}/messages?order=asc`)
    const body = (await messages.json()) as { data: { id: string; type: string }[] }
    expect(body.data[0]).toMatchObject({ id: inbox.id, type: 'user' })
    expect(body.data[1]).toMatchObject({ type: 'assistant' })
    await runtime.close()
  })

  it('lists models, providers, commands, and skills from Pi', async () => {
    const { app, project, runtime } = await fixture()
    const models = (await (
      await app.request(`/harness/v1/models?directory=${project}`)
    ).json()) as {
      data: { id: string; providerID: string }[]
    }
    expect(models.data).toEqual([expect.objectContaining({ id: 'fake-model', providerID: 'fake' })])

    const providers = (await (
      await app.request(`/harness/v1/providers?directory=${project}`)
    ).json()) as { data: { id: string }[] }
    expect(providers.data[0]).toMatchObject({ id: 'fake' })

    const commands = (await (
      await app.request(`/harness/v1/commands?directory=${project}`)
    ).json()) as { data: { name: string }[] }
    expect(commands.data.map((command) => command.name)).toEqual(['review'])

    const skills = (await (
      await app.request(`/harness/v1/skills?directory=${project}`)
    ).json()) as { data: { name: string }[] }
    expect(skills.data.map((skill) => skill.name)).toEqual(['fake'])
    await runtime.close()
  })

  it('returns an error envelope for a missing session', async () => {
    const { app, runtime } = await fixture()
    const response = await app.request('/harness/v1/sessions/missing')
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: { code: 'SessionNotFoundError' },
    })
    await runtime.close()
  })
})
