import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaraEvent } from '@clara/api-contract'
import type { PiConfig } from '../src/config.ts'
import { EventBus } from '../src/events.ts'
import { SessionIndex } from '../src/pi/indexer.ts'
import { PromptMap } from '../src/prompt-map.ts'
import { PiRuntime } from '../src/runtime.ts'
import { SessionService } from '../src/sessions.ts'

const fake = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url))
const originalEnv = { ...process.env }

afterEach(() => {
  for (const key of ['FAKE_PI_UI', 'FAKE_PI_ERROR']) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'clara-pi-runtime-'))
  const project = join(root, 'project')
  mkdirSync(project)
  const config: PiConfig = {
    piPath: fake,
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    idleTimeoutMinutes: 1,
    maxProcesses: 2,
  }
  const events: ClaraEvent[] = []
  const bus = new EventBus()
  bus.subscribe((event) => events.push(event))
  const index = new SessionIndex(() => [join(root, 'sessions')])
  const sessions = new SessionService(
    config,
    index,
    new PromptMap(join(root, 'prompt-ids.json')),
    '0.1.0',
    (event) => bus.publish(event)
  )
  const runtime = new PiRuntime(config, fake, sessions, bus)
  return { root, project, events, sessions, runtime }
}

function idle(events: ClaraEvent[], sessionID: string, timeoutMs = 5_000): Promise<void> {
  const existing = events.find(
    (event) => event.type === 'session.idle' && event.data.sessionID === sessionID
  )
  if (existing) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const timer = setInterval(() => {
      const found = events.find(
        (event) => event.type === 'session.idle' && event.data.sessionID === sessionID
      )
      if (found) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        reject(new Error('timed out waiting for session.idle'))
      }
    }, 20)
  })
}

describe('Pi runtime', () => {
  it('streams a turn and reuses the inbox id in history', async () => {
    const { project, events, sessions, runtime } = fixture()
    const session = await sessions.create({ location: { directory: project }, title: 'Run' })
    const item = await runtime.prompt(session.id, { text: 'hello' })
    await idle(events, session.id)

    const types = events.map((event) => event.type)
    expect(types).toContain('session.execution.started')
    expect(types).toContain('session.step.started')
    expect(types).toContain('session.reasoning.delta')
    expect(types).toContain('session.text.delta')
    expect(types).toContain('session.step.ended')
    expect(types).toContain('session.execution.succeeded')
    expect(types).toContain('session.idle')
    expect(types).toContain('session.usage.updated')

    const step = events.find((event) => event.type === 'session.step.started')
    if (step?.type !== 'session.step.started') throw new Error('no step')
    expect(step.data.assistantMessageID).toMatch(/^pi-a-\d+$/)

    const messages = await sessions.messages(session.id, { order: 'asc' })
    expect(messages.data).toHaveLength(2)
    expect(messages.data[0]).toMatchObject({ id: item.id, type: 'user', text: 'hello' })
    expect(messages.data[1]).toMatchObject({ type: 'assistant', agent: 'pi' })
    expect(messages.data[1]?.id).toBe(step.data.assistantMessageID)

    await runtime.close()
  })

  it('maps an extension confirm dialog to a permission request', async () => {
    process.env.FAKE_PI_UI = 'confirm'
    const { project, events, sessions, runtime } = fixture()
    const session = await sessions.create({ location: { directory: project } })
    await runtime.prompt(session.id, { text: 'run it' })

    const started = Date.now()
    while (runtime.permissions().length === 0 && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const pending = runtime.permissions()[0]
    expect(pending).toMatchObject({ sessionID: session.id, action: 'extension' })
    if (!pending) throw new Error('no pending permission')
    await runtime.replyPermission(session.id, pending.id, 'once')
    await idle(events, session.id)
    expect(events.map((event) => event.type)).toContain('permission.replied')
    await runtime.close()
  })

  it('reports a failed run when Pi ends the turn with an error', async () => {
    process.env.FAKE_PI_ERROR = '1'
    const { project, events, sessions, runtime } = fixture()
    const session = await sessions.create({ location: { directory: project } })
    await runtime.prompt(session.id, { text: 'fail' })
    await idle(events, session.id)
    expect(events.map((event) => event.type)).toContain('session.execution.failed')
    await runtime.close()
  })
})
