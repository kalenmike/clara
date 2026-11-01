import { createECDH, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import webpush from 'web-push'
import {
  clearPushSubscriptions,
  normalizePushSubscription,
  PushSubscriptionStore,
} from '../src/push/store.ts'
import { buildPushPayload } from '../src/push/payload.ts'
import { PushService } from '../src/push/service.ts'
import { parseSse } from '../src/push/sse.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-push-'))
  tempDirs.push(dir)
  return dir
}

function subscription() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    endpoint: 'https://web.push.apple.com/abc123',
    expirationTime: null,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: Buffer.from(randomBytes(16)).toString('base64url'),
    },
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PushSubscriptionStore', () => {
  it('persists subscriptions and updates an existing endpoint in place', () => {
    const path = join(tempDir(), 'subscriptions.json')
    const store = new PushSubscriptionStore(path)
    const first = subscription()

    expect(store.upsert(first, { userAgent: 'iPhone' }).count).toBe(1)
    expect(store.upsert(first, { userAgent: 'iPhone 15' }).count).toBe(1)
    expect(store.list()[0]?.userAgent).toBe('iPhone 15')

    const reloaded = new PushSubscriptionStore(path)
    expect(reloaded.size).toBe(1)
    expect(JSON.parse(readFileSync(path, 'utf8')).subscriptions[0].endpoint).toBe(first.endpoint)
    expect(reloaded.remove(first.endpoint)).toBe(true)
    expect(reloaded.size).toBe(0)
  })

  it('keeps the device class used for notification routing', () => {
    const path = join(tempDir(), 'subscriptions.json')
    const store = new PushSubscriptionStore(path)
    const desktop = { ...subscription(), endpoint: 'https://web.push.apple.com/desktop' }
    const mobile = { ...subscription(), endpoint: 'https://web.push.apple.com/mobile' }

    store.upsert(desktop, { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', deviceClass: 'desktop' })
    store.upsert(mobile, { userAgent: 'Mozilla/5.0 (iPhone)', deviceClass: 'mobile' })

    expect(store.list().map((entry) => entry.deviceClass)).toEqual(['desktop', 'mobile'])

    const reloaded = new PushSubscriptionStore(path)
    expect(reloaded.list().map((entry) => entry.deviceClass)).toEqual(['desktop', 'mobile'])
  })

  it('falls back to the user agent when a stored subscription has no device class', () => {
    const path = join(tempDir(), 'subscriptions.json')
    const store = new PushSubscriptionStore(path)
    const sub = subscription()
    store.upsert(sub, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' })

    expect(store.list()[0]?.deviceClass).toBe('mobile')
    expect(new PushSubscriptionStore(path).list()[0]?.deviceClass).toBe('mobile')
  })

  it('rejects non-HTTPS endpoints and malformed keys', () => {
    expect(() =>
      normalizePushSubscription({ ...subscription(), endpoint: 'http://localhost/push' })
    ).toThrow(/HTTPS/)
    expect(() =>
      normalizePushSubscription({
        ...subscription(),
        keys: { p256dh: 'short', auth: 'short' },
      })
    ).toThrow(/p256dh/)
  })

  it('clears the stored file during pairing rotation', () => {
    const path = join(tempDir(), 'subscriptions.json')
    const store = new PushSubscriptionStore(path)
    store.upsert(subscription())
    expect(clearPushSubscriptions(path)).toBe(1)
    expect(new PushSubscriptionStore(path).size).toBe(0)
  })
})

describe('push payloads', () => {
  it('uses the Clara attention labels and keeps the reason readable', () => {
    const error = buildPushPayload({
      kind: 'error',
      sessionID: 's1',
      sessionTitle: 'Fix the relay',
      detail: 'provider quota',
      url: '/p/p1/s/s1',
    })
    expect(error.title).toBe('Clara · Error')
    expect(error.body).toContain('Fix the relay')
    expect(error.body).toContain('provider quota')

    expect(
      buildPushPayload({
        kind: 'question',
        sessionID: 's1',
        sessionTitle: 'Fix the relay',
        url: '/',
      }).title
    ).toBe('Clara · Needs Input')
    expect(
      buildPushPayload({
        kind: 'plan',
        sessionID: 's1',
        sessionTitle: 'Fix the relay',
        url: '/',
      }).title
    ).toBe('Clara · Ready for Review')
    expect(
      buildPushPayload({
        kind: 'review',
        sessionID: 's1',
        sessionTitle: 'Fix the relay',
        url: '/',
      }).title
    ).toBe('Clara · Brief Complete')
  })
})

describe('PushService', () => {
  it('sends a payload and records the delivery', async () => {
    const store = new PushSubscriptionStore(join(tempDir(), 'subscriptions.json'))
    const sub = subscription()
    store.upsert(sub)
    const sent: string[] = []
    const service = new PushService({
      ...webpush.generateVAPIDKeys(),
      subject: 'https://clara.example.com',
      store,
      send: async (_subscription, payload) => {
        sent.push(payload)
        return { statusCode: 201 }
      },
    })

    const payload = buildPushPayload({
      kind: 'review',
      sessionID: 's1',
      sessionTitle: 'A session',
      url: '/',
    })
    await service.notify(payload)

    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).title).toBe('Clara · Brief Complete')
    expect(store.list()[0]?.lastSuccessAt).toBeTypeOf('number')
  })

  it('holds mobile devices while a desktop client is active', async () => {
    const store = new PushSubscriptionStore(join(tempDir(), 'subscriptions.json'))
    const desktop = { ...subscription(), endpoint: 'https://web.push.apple.com/desktop' }
    const mobile = { ...subscription(), endpoint: 'https://web.push.apple.com/mobile' }
    store.upsert(desktop, { deviceClass: 'desktop' })
    store.upsert(mobile, { deviceClass: 'mobile' })

    const sent: string[] = []
    const service = new PushService({
      ...webpush.generateVAPIDKeys(),
      subject: 'https://clara.example.com',
      store,
      send: async (entry) => {
        sent.push(entry.endpoint)
        return { statusCode: 201 }
      },
    })

    const payload = buildPushPayload({
      kind: 'review',
      sessionID: 's1',
      sessionTitle: 'A session',
      url: '/',
    })

    await service.notify(payload, { skipMobile: true })
    expect(sent).toEqual([desktop.endpoint])

    sent.length = 0
    await service.notify(payload)
    expect(sent.sort()).toEqual([desktop.endpoint, mobile.endpoint].sort())
  })

  it('drops a subscription that the push service reports as gone', async () => {
    const store = new PushSubscriptionStore(join(tempDir(), 'subscriptions.json'))
    const sub = subscription()
    store.upsert(sub)
    const service = new PushService({
      ...webpush.generateVAPIDKeys(),
      subject: 'https://clara.example.com',
      store,
      send: async () => {
        throw Object.assign(new Error('gone'), { statusCode: 410 })
      },
    })

    await service.notify(
      buildPushPayload({
        kind: 'error',
        sessionID: 's1',
        sessionTitle: 'A session',
        url: '/',
      })
    )

    expect(store.size).toBe(0)
  })

  it('reports a failed test notification instead of claiming success', async () => {
    const store = new PushSubscriptionStore(join(tempDir(), 'subscriptions.json'))
    const sub = subscription()
    store.upsert(sub)
    const service = new PushService({
      ...webpush.generateVAPIDKeys(),
      subject: 'https://clara.example.com',
      store,
      send: async () => {
        throw new Error('self-signed certificate')
      },
    })

    await expect(service.test(sub.endpoint)).rejects.toThrow(/self-signed/)
  })
})

describe('parseSse', () => {
  it('parses CRLF events and ignores comments', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(': keepalive\r\n\r\ndata: {"type":"session.idle"}\r\n\r\n')
        )
        controller.enqueue(encoder.encode('data: {"type":"permission.asked"}\n\n'))
        controller.close()
      },
    })

    const events: unknown[] = []
    for await (const event of parseSse(stream)) events.push(event)

    expect(events).toEqual([{ type: 'session.idle' }, { type: 'permission.asked' }])
  })
})
