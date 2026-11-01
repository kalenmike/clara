import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DeviceClass, PushSubscriptionPayload } from '@clara/shared-types'

const MAX_SUBSCRIPTIONS = 32
const MAX_ENDPOINT_LENGTH = 2048
const MAX_USER_AGENT_LENGTH = 200
const MAX_ERROR_LENGTH = 240
const FILE_VERSION = 1

export type StoredPushSubscription = PushSubscriptionPayload & {
  createdAt: number
  updatedAt: number
  userAgent?: string
  deviceClass?: DeviceClass
  lastSuccessAt?: number
  lastError?: string
}

type StoreFile = {
  version: number
  subscriptions: StoredPushSubscription[]
}

export type SubscriptionMeta = {
  userAgent?: string
  deviceClass?: DeviceClass
}

export type SubscriptionResult = {
  count: number
  subscription: StoredPushSubscription
}

export class PushSubscriptionStore {
  private readonly path: string
  private readonly log?: (message: string, detail?: unknown) => void
  private entries: StoredPushSubscription[]

  constructor(path: string, log?: (message: string, detail?: unknown) => void) {
    this.path = path
    this.log = log
    this.entries = this.read()
  }

  get size(): number {
    return this.entries.length
  }

  list(): readonly StoredPushSubscription[] {
    return this.entries
  }

  has(endpoint: string): boolean {
    return this.entries.some((entry) => entry.endpoint === endpoint)
  }

  upsert(subscription: PushSubscriptionPayload, meta: SubscriptionMeta = {}): SubscriptionResult {
    const normalized = normalizePushSubscription(subscription)
    const now = Date.now()
    const index = this.entries.findIndex((entry) => entry.endpoint === normalized.endpoint)

    if (index === -1 && this.entries.length >= MAX_SUBSCRIPTIONS) {
      throw new Error(`At most ${MAX_SUBSCRIPTIONS} push subscriptions are supported`)
    }

    const previous = index === -1 ? undefined : this.entries[index]
    const userAgent = normalizeUserAgent(meta.userAgent)
    const deviceClass =
      normalizeDeviceClass(meta.deviceClass) ??
      previous?.deviceClass ??
      classifyUserAgent(userAgent)
    const entry: StoredPushSubscription = {
      ...normalized,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      ...(userAgent ? { userAgent } : {}),
      ...(deviceClass ? { deviceClass } : {}),
      ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
      ...(previous?.lastError ? { lastError: previous.lastError } : {}),
    }

    if (index === -1) this.entries.push(entry)
    else this.entries[index] = entry
    this.persist()

    return { count: this.entries.length, subscription: entry }
  }

  remove(endpoint: string): boolean {
    const next = this.entries.filter((entry) => entry.endpoint !== endpoint)
    if (next.length === this.entries.length) return false
    this.entries = next
    this.persist()
    return true
  }

  markSuccess(endpoint: string): void {
    this.updateStatus(endpoint, { lastSuccessAt: Date.now(), lastError: undefined })
  }

  markFailure(endpoint: string, error: string): void {
    this.updateStatus(endpoint, { lastError: clip(error, MAX_ERROR_LENGTH) })
  }

  clear(): number {
    const count = this.entries.length
    if (count === 0) return 0
    this.entries = []
    this.persist()
    return count
  }

  private updateStatus(
    endpoint: string,
    patch: Pick<StoredPushSubscription, 'lastSuccessAt' | 'lastError'>
  ): void {
    const entry = this.entries.find((item) => item.endpoint === endpoint)
    if (!entry) return
    if (patch.lastSuccessAt !== undefined) entry.lastSuccessAt = patch.lastSuccessAt
    if (patch.lastError === undefined) delete entry.lastError
    else entry.lastError = patch.lastError
    this.persist()
  }

  private read(): StoredPushSubscription[] {
    if (!existsSync(this.path)) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (cause) {
      throw new Error(`Could not read ${this.path}: ${errorMessage(cause)}`, { cause })
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.subscriptions)) {
      throw new Error(`${this.path} is not a valid Clara subscriptions file`)
    }

    const entries: StoredPushSubscription[] = []
    for (const candidate of parsed.subscriptions) {
      try {
        const subscription = normalizePushSubscription(candidate)
        const record = candidate as Record<string, unknown>
        const userAgent = normalizeUserAgent(record.userAgent)
        const deviceClass = normalizeDeviceClass(record.deviceClass) ?? classifyUserAgent(userAgent)
        const lastSuccessAt = readTimestamp(record.lastSuccessAt)
        entries.push({
          ...subscription,
          createdAt: readTimestamp(record.createdAt),
          updatedAt: readTimestamp(record.updatedAt),
          ...(userAgent ? { userAgent } : {}),
          ...(deviceClass ? { deviceClass } : {}),
          ...(lastSuccessAt ? { lastSuccessAt } : {}),
          ...(typeof record.lastError === 'string'
            ? { lastError: clip(record.lastError, MAX_ERROR_LENGTH) }
            : {}),
        })
      } catch (cause) {
        this.log?.('ignoring an invalid push subscription', cause)
      }
    }
    return entries
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const body: StoreFile = { version: FILE_VERSION, subscriptions: this.entries }
    const temp = `${this.path}.tmp`
    writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, this.path)
  }
}

/** Remove every stored subscription, for example after rotating the pairing key. */
export function clearPushSubscriptions(path: string): number {
  if (!existsSync(path)) return 0
  let count = 0
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { subscriptions?: unknown }
    if (Array.isArray(parsed.subscriptions)) count = parsed.subscriptions.length
  } catch {
    // A malformed file still needs to be removed.
  }
  rmSync(path, { force: true })
  rmSync(`${path}.tmp`, { force: true })
  return count
}

export function normalizePushSubscription(value: unknown): PushSubscriptionPayload {
  if (!isRecord(value)) throw new Error('A push subscription must be an object')

  const endpoint = value.endpoint
  if (
    typeof endpoint !== 'string' ||
    endpoint.length === 0 ||
    endpoint.length > MAX_ENDPOINT_LENGTH
  ) {
    throw new Error('The push endpoint is missing or too long')
  }
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('The push endpoint is not a valid URL')
  }
  if (url.protocol !== 'https:') throw new Error('The push endpoint must use HTTPS')

  const keys = value.keys
  if (!isRecord(keys)) throw new Error('The push subscription keys are missing')
  const p256dh = keys.p256dh
  const auth = keys.auth
  if (!isValidKey(p256dh, 65) || Buffer.from(p256dh, 'base64url')[0] !== 0x04) {
    throw new Error('The push p256dh key is invalid')
  }
  if (!isValidKey(auth, 16)) throw new Error('The push auth key is invalid')

  const expirationTime = value.expirationTime
  if (
    expirationTime !== undefined &&
    expirationTime !== null &&
    (typeof expirationTime !== 'number' || !Number.isFinite(expirationTime))
  ) {
    throw new Error('The push expiration time is invalid')
  }

  return {
    endpoint,
    ...(expirationTime !== undefined ? { expirationTime } : {}),
    keys: { p256dh, auth },
  }
}

function isValidKey(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false
  try {
    return Buffer.from(value, 'base64url').byteLength === expectedBytes
  } catch {
    return false
  }
}

function normalizeUserAgent(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean ? clip(clean, MAX_USER_AGENT_LENGTH) : undefined
}

function normalizeDeviceClass(value: unknown): DeviceClass | undefined {
  return value === 'desktop' || value === 'mobile' ? value : undefined
}

/** Older subscriptions predate `deviceClass`; fall back to the stored user agent. */
function classifyUserAgent(value: string | undefined): DeviceClass | undefined {
  if (!value) return undefined
  return /Android|iPhone|iPad|iPod|Mobile/i.test(value) ? 'mobile' : 'desktop'
}

function readTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
