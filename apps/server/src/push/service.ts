import type { PushSubscriptionPayload } from '@clara/shared-types'
import webpush, { type PushSubscription, type RequestOptions } from 'web-push'
import {
  PushSubscriptionStore,
  type StoredPushSubscription,
  type SubscriptionMeta,
} from './store.ts'
import type { PushNotificationPayload } from './payload.ts'

const PUSH_TTL_SECONDS = 300
const PUSH_TIMEOUT_MS = 10_000

type Sender = (
  subscription: PushSubscription,
  payload: string,
  options: RequestOptions
) => Promise<{ statusCode?: number }>

export type PushServiceOptions = {
  publicKey: string
  privateKey: string
  subject: string
  store: PushSubscriptionStore
  log?: (message: string, detail?: unknown) => void
  send?: Sender
}

export class PushService {
  readonly publicKey: string
  private readonly store: PushSubscriptionStore
  private readonly log?: (message: string, detail?: unknown) => void
  private readonly send: Sender

  constructor(options: PushServiceOptions) {
    this.publicKey = options.publicKey
    this.store = options.store
    this.log = options.log
    this.send = options.send ?? defaultSender
    webpush.setVapidDetails(options.subject, options.publicKey, options.privateKey)
  }

  get count(): number {
    return this.store.size
  }

  has(endpoint: string): boolean {
    return this.store.has(endpoint)
  }

  subscribe(
    subscription: PushSubscriptionPayload,
    meta?: SubscriptionMeta
  ): { count: number; endpoint: string } {
    const result = this.store.upsert(subscription, meta)
    this.log?.(`push subscription saved (${result.count} device(s))`)
    return { count: result.count, endpoint: result.subscription.endpoint }
  }

  unsubscribe(endpoint: string): { count: number; removed: boolean } {
    const removed = this.store.remove(endpoint)
    if (removed) this.log?.(`push subscription removed (${this.store.size} device(s))`)
    return { count: this.store.size, removed }
  }

  async test(endpoint?: string): Promise<{ count: number }> {
    const payload: PushNotificationPayload = {
      v: 1,
      kind: 'review',
      sessionID: 'test',
      title: 'Clara · Test',
      body: 'Push notifications are working on this device.',
      url: '/',
      tag: 'clara:test',
    }
    const text = JSON.stringify(payload)

    if (endpoint) {
      const subscription = this.store.list().find((entry) => entry.endpoint === endpoint)
      if (!subscription) throw new Error('This device is not registered for push notifications')
      const result = await this.sendOne(subscription, text)
      if (!result.ok) throw new Error(result.error ?? 'Push delivery failed')
      return { count: this.store.size }
    }

    await this.sendAll(text)
    return { count: this.store.size }
  }

  async notify(payload: PushNotificationPayload): Promise<void> {
    if (this.store.size === 0) return
    await this.sendAll(JSON.stringify(payload))
  }

  private async sendAll(text: string): Promise<void> {
    const subscriptions = [...this.store.list()]
    await Promise.allSettled(subscriptions.map((entry) => this.sendOne(entry, text)))
  }

  private async sendOne(
    subscription: StoredPushSubscription,
    text: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.send(
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime ?? null,
          keys: subscription.keys,
        },
        text,
        {
          TTL: PUSH_TTL_SECONDS,
          urgency: 'high',
          timeout: PUSH_TIMEOUT_MS,
        }
      )
      if (result.statusCode && result.statusCode >= 400) {
        throw Object.assign(new Error(`Push endpoint responded with ${result.statusCode}`), {
          statusCode: result.statusCode,
        })
      }
      this.store.markSuccess(subscription.endpoint)
      return { ok: true }
    } catch (cause) {
      const statusCode = readStatusCode(cause)
      if (statusCode === 404 || statusCode === 410) {
        this.store.remove(subscription.endpoint)
        this.log?.(`push subscription expired (${statusCode})`)
        return { ok: false, error: 'The push subscription has expired' }
      }
      const message = cause instanceof Error ? cause.message : String(cause)
      this.store.markFailure(subscription.endpoint, message)
      this.log?.(`push delivery failed${statusCode ? ` (${statusCode})` : ''}`, cause)
      return { ok: false, error: message }
    }
  }
}

function defaultSender(
  subscription: PushSubscription,
  payload: string,
  options: RequestOptions
): Promise<{ statusCode?: number }> {
  return webpush.sendNotification(subscription, payload, options)
}

function readStatusCode(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object') return undefined
  const statusCode = (cause as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}
