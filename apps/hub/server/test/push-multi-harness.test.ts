import { describe, expect, it, vi } from 'vitest'
import type { ClaraSession } from '@clara/api-contract'
import type { HarnessManager } from '../src/harness/manager.ts'
import type { PushNotificationPayload } from '../src/push/payload.ts'
import { PushMonitor } from '../src/push/monitor.ts'
import type { PushNotifyOptions, PushService } from '../src/push/service.ts'

const connection = (harnessID: string, online: boolean, active: boolean) => ({
  id: `connection-${harnessID}`,
  harnessId: harnessID,
  kind: 'opencode',
  label: harnessID,
  transport: 'local' as const,
  online,
  capabilities: {},
  isActive: active,
  credentialConfigured: true,
  createdAt: 1,
  updatedAt: 1,
})

const remoteSession: ClaraSession = {
  id: 's-b',
  projectID: 'hp-b',
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  title: 'Remote session',
  location: { directory: '/workspace/remote' },
}

type HarnessStreams = Map<string, ReadableStreamDefaultController<Uint8Array>>

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeHarness(options: { online?: () => Set<string> } = {}) {
  const calls: string[] = []
  const streams: HarnessStreams = new Map()
  const cancelled = new Set<string>()
  const encoder = new TextEncoder()
  const online = options.online ?? (() => new Set(['harness-a', 'harness-b']))

  const requestFor = async (
    harnessID: string,
    input: { path: string; search?: string },
    signal: AbortSignal
  ): Promise<Response> => {
    calls.push(`${harnessID}:${input.path}`)
    if (input.path === '/events') {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.set(harnessID, controller)
        },
        cancel() {
          cancelled.add(harnessID)
        },
      })
      signal.addEventListener(
        'abort',
        () => {
          try {
            streams.get(harnessID)?.close()
          } catch {
            // The test has already closed the stream.
          }
          cancelled.add(harnessID)
        },
        { once: true }
      )
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    if (input.path === '/sessions/s-b') return json({ data: remoteSession })
    if (input.path === '/sessions/s-b/messages') {
      const type = new URLSearchParams(input.search).get('type')
      return json({
        data: [
          type === 'assistant'
            ? { type: 'assistant', time: { created: 2 }, agent: 'build', finish: 'stop' }
            : { type: 'user', time: { created: 1 } },
        ],
      })
    }
    if (input.path === '/sessions/s-b/forms') return json({ data: [] })
    return json({ error: { code: 'not_found', message: 'not found' } }, 404)
  }

  const harness = {
    list: () =>
      [...online()].map((harnessID) => connection(harnessID, true, harnessID === 'harness-a')),
    requestFor,
    overlaySession: (_harnessID: string, session: ClaraSession) => session,
    projects: {
      projectForHarnessProject: (harnessID: string, projectID: string) =>
        harnessID === 'harness-b' && projectID === 'hp-b' ? { id: 'p_remote' } : undefined,
      get: (projectID: string) => (projectID === 'p_remote' ? { id: 'p_remote' } : undefined),
      workspacesForDirectory: () => [],
    },
  } as unknown as HarnessManager

  return { harness, calls, streams, cancelled, encoder }
}

function fakePush() {
  const notifications: PushNotificationPayload[] = []
  const options: PushNotifyOptions[] = []
  const push = {
    count: 1,
    notify: async (payload: PushNotificationPayload, notifyOptions: PushNotifyOptions = {}) => {
      notifications.push(payload)
      options.push(notifyOptions)
    },
  } as unknown as PushService
  return { push, notifications, options }
}

describe('PushMonitor across harnesses', () => {
  it('notifies for an idle event from a non-active harness with that harness URL', async () => {
    const fake = fakeHarness()
    const { push, notifications } = fakePush()
    const monitor = new PushMonitor({ harness: fake.harness, push })

    try {
      monitor.start()
      await vi.waitFor(() => expect(fake.streams.size).toBe(2))

      fake.streams
        .get('harness-b')
        ?.enqueue(
          fake.encoder.encode(
            `data: ${JSON.stringify({ type: 'session.idle', data: { sessionID: 's-b' } })}\n\n`
          )
        )

      await vi.waitFor(() => expect(notifications).toHaveLength(1))
      expect(notifications[0]).toMatchObject({
        kind: 'review',
        sessionID: 's-b',
        url: '/p/p_remote/s/s-b',
      })
      expect(fake.calls).toContain('harness-b:/sessions/s-b')
      expect(fake.calls).not.toContain('harness-a:/sessions/s-b')
    } finally {
      monitor.close()
    }
  })

  it('passes worker suppression to push instead of dropping the alert', async () => {
    const fake = fakeHarness()
    const { push, notifications, options } = fakePush()
    const monitor = new PushMonitor({
      harness: fake.harness,
      push,
      suppressForOrchestratorClients: () => true,
    })

    try {
      monitor.start()
      await vi.waitFor(() => expect(fake.streams.size).toBe(2))

      fake.streams
        .get('harness-b')
        ?.enqueue(
          fake.encoder.encode(
            `data: ${JSON.stringify({ type: 'session.idle', data: { sessionID: 's-b' } })}\n\n`
          )
        )

      await vi.waitFor(() => expect(notifications).toHaveLength(1))
      expect(options[0]?.skipOrchestratorClients).toBe(true)
    } finally {
      monitor.close()
    }
  })

  it('reconciles only the stream for a harness that goes offline', async () => {
    let online = new Set(['harness-a', 'harness-b'])
    const fake = fakeHarness({ online: () => online })
    const { push } = fakePush()
    const monitor = new PushMonitor({ harness: fake.harness, push })

    try {
      monitor.start()
      await vi.waitFor(() => expect(fake.streams.size).toBe(2))

      online = new Set(['harness-a'])
      monitor.sync()

      await vi.waitFor(() => expect(fake.cancelled.has('harness-b')).toBe(true))
      expect(fake.cancelled.has('harness-a')).toBe(false)
    } finally {
      monitor.close()
    }
  })
})
