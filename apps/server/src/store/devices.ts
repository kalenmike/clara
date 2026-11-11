import { Buffer } from 'node:buffer'
import {
  bytesToBase64Url,
  fingerprintKey,
  generateKey,
  openSecret,
  parseKey,
  randomBytes,
  sealSecret,
} from '@clara/crypto'
import { MAX_DEVICE_ALIAS_LENGTH, type DeviceClass, type PanelTransport } from '@clara/shared-types'
import type { ClaraDatabase } from './database.ts'

export const MAX_DEVICES = 32
export const PAIRING_TOKEN_TTL_MS = 10 * 60_000
const MAX_LABEL = 64
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
const TOUCH_INTERVAL_MS = 60_000

export type DeviceInfo = {
  id: string
  label: string
  alias?: string
  fingerprint: string
  createdAt: number
  updatedAt: number
  lastSeenAt?: number
  lastTransport?: PanelTransport
  lastDeviceClass?: DeviceClass
  revokedAt?: number
}

export type ActiveDevice = {
  id: string
  key: string
  label: string
  fingerprint: string
}

export type PairingToken = {
  id: string
  token: string
  fingerprint: string
  expiresAt: number
}

export type DeviceTouchMeta = {
  transport?: PanelTransport
  deviceClass?: DeviceClass
}

export type EnrollDeviceInput = {
  pairingTokenId: string
  deviceId: string
  key: string
  label: string
  transport?: PanelTransport
  deviceClass?: DeviceClass
}

/** The agent only needs this subset; tests can provide an in-memory double. */
export interface DeviceRegistry {
  findPairingToken(id: string): Promise<PairingToken | undefined>
  findActiveDevice(id: string): Promise<ActiveDevice | undefined>
  isActive(id: string): boolean
  enrollDevice(input: EnrollDeviceInput): Promise<DeviceInfo>
  touchDevice(id: string, meta?: DeviceTouchMeta): void
}

export class DeviceStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DeviceStoreError'
    this.code = code
  }
}

type DeviceRow = {
  id: string
  label: string
  alias: string | null
  fingerprint: string
  created_at: number
  updated_at: number
  last_seen_at: number | null
  last_transport: PanelTransport | null
  last_device_class: DeviceClass | null
  revoked_at: number | null
}

type KeyRow = {
  ciphertext: Buffer
  nonce: Buffer
  key_version: number
}

type TokenRow = {
  id: string
  ciphertext: Buffer
  nonce: Buffer
  key_version: number
  fingerprint: string
  expires_at: number
  used_at: number | null
  used_device_id: string | null
}

export class DeviceStore implements DeviceRegistry {
  private readonly db: ClaraDatabase
  private readonly key: CryptoKey
  private readonly keyVersion: number

  constructor(options: { db: ClaraDatabase; key: CryptoKey; keyVersion: number }) {
    this.db = options.db
    this.key = options.key
    this.keyVersion = options.keyVersion
  }

  async createPairingToken(ttlMs = PAIRING_TOKEN_TTL_MS): Promise<PairingToken> {
    const id = bytesToBase64Url(randomBytes(16))
    const token = generateKey()
    const fingerprint = await fingerprintKey(token)
    const box = await sealSecret(this.key, pairingAad(id), token)
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO pairing_tokens
           (id, ciphertext, nonce, key_version, fingerprint, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        Buffer.from(box.ct, 'base64url'),
        Buffer.from(box.iv, 'base64url'),
        this.keyVersion,
        fingerprint,
        now,
        now + ttlMs
      )
    return { id, token, fingerprint, expiresAt: now + ttlMs }
  }

  async findPairingToken(id: string): Promise<PairingToken | undefined> {
    const row = this.db
      .prepare(
        `SELECT id, ciphertext, nonce, key_version, fingerprint, expires_at, used_at, used_device_id
           FROM pairing_tokens
          WHERE id = ? AND used_at IS NULL AND expires_at > ?`
      )
      .get(id, Date.now()) as TokenRow | undefined
    if (!row) return undefined
    const token = await openSecret(this.key, pairingAad(row.id), {
      iv: row.nonce.toString('base64url'),
      ct: row.ciphertext.toString('base64url'),
    }).catch(() => undefined)
    if (!token) return undefined
    return { id: row.id, token, fingerprint: row.fingerprint, expiresAt: row.expires_at }
  }

  async findActiveDevice(id: string): Promise<ActiveDevice | undefined> {
    const row = this.db
      .prepare(
        `SELECT d.id, d.label, d.fingerprint, k.ciphertext, k.nonce, k.key_version
           FROM devices d
           JOIN device_keys k ON k.device_id = d.id
          WHERE d.id = ? AND d.revoked_at IS NULL`
      )
      .get(id) as (DeviceRow & KeyRow) | undefined
    if (!row) return undefined
    const key = await openSecret(this.key, deviceAad(row.id), {
      iv: row.nonce.toString('base64url'),
      ct: row.ciphertext.toString('base64url'),
    }).catch(() => undefined)
    if (!key) return undefined
    return { id: row.id, key, label: row.label, fingerprint: row.fingerprint }
  }

  isActive(id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS found
           FROM devices d
           JOIN device_keys k ON k.device_id = d.id
          WHERE d.id = ? AND d.revoked_at IS NULL`
      )
      .get(id) as { found: number } | undefined
    return row !== undefined
  }

  async enrollDevice(input: EnrollDeviceInput): Promise<DeviceInfo> {
    validateDeviceId(input.deviceId)
    parseKey(input.key)
    const label = normalizeLabel(input.label)

    const token = this.db
      .prepare(
        `SELECT id, used_at, used_device_id
           FROM pairing_tokens
          WHERE id = ? AND expires_at > ?`
      )
      .get(input.pairingTokenId, Date.now()) as
      { id: string; used_at: number | null; used_device_id: string | null } | undefined
    if (!token) {
      throw new DeviceStoreError('enrollment_invalid', 'The pairing code is invalid or expired')
    }
    if (token.used_at !== null && token.used_device_id !== input.deviceId) {
      throw new DeviceStoreError('enrollment_used', 'This pairing code has already been used')
    }

    const existing = this.db
      .prepare(
        `SELECT d.id, d.label, d.alias, d.fingerprint, d.created_at, d.updated_at, d.last_seen_at,
                d.last_transport, d.last_device_class, d.revoked_at,
                k.ciphertext, k.nonce, k.key_version
           FROM devices d
           LEFT JOIN device_keys k ON k.device_id = d.id
          WHERE d.id = ?`
      )
      .get(input.deviceId) as (DeviceRow & Partial<KeyRow>) | undefined

    if (existing) {
      if (existing.revoked_at !== null) {
        throw new DeviceStoreError('revoked_device', 'This device has been revoked')
      }
      const existingKey = existing.ciphertext
        ? await openSecret(this.key, deviceAad(existing.id), {
            iv: existing.nonce?.toString('base64url') ?? '',
            ct: existing.ciphertext.toString('base64url'),
          }).catch(() => undefined)
        : undefined
      if (existingKey !== input.key) {
        throw new DeviceStoreError('invalid_device', 'That device id is already enrolled')
      }
      this.consumeToken(token.id, input.deviceId)
      return toInfo(existing)
    }

    const active = this.db
      .prepare('SELECT COUNT(*) AS count FROM devices WHERE revoked_at IS NULL')
      .get() as { count: number }
    if (active.count >= MAX_DEVICES) {
      throw new DeviceStoreError('device_limit', `At most ${MAX_DEVICES} devices are supported`)
    }

    const fingerprint = await fingerprintKey(input.key)
    const box = await sealSecret(this.key, deviceAad(input.deviceId), input.key)
    const now = Date.now()
    const write = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO devices
             (id, label, fingerprint, created_at, updated_at, last_seen_at,
              last_transport, last_device_class)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.deviceId,
          label,
          fingerprint,
          now,
          now,
          now,
          input.transport ?? null,
          input.deviceClass ?? null
        )
      this.db
        .prepare(
          `INSERT INTO device_keys (device_id, ciphertext, nonce, key_version)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          input.deviceId,
          Buffer.from(box.ct, 'base64url'),
          Buffer.from(box.iv, 'base64url'),
          this.keyVersion
        )
      this.consumeToken(input.pairingTokenId, input.deviceId)
    })
    write()

    return {
      id: input.deviceId,
      label,
      fingerprint,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      ...(input.transport ? { lastTransport: input.transport } : {}),
      ...(input.deviceClass ? { lastDeviceClass: input.deviceClass } : {}),
    }
  }

  listDevices(): DeviceInfo[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, alias, fingerprint, created_at, updated_at, last_seen_at,
                last_transport, last_device_class, revoked_at
           FROM devices
          ORDER BY revoked_at IS NOT NULL, created_at ASC`
      )
      .all() as DeviceRow[]
    return rows.map(toInfo)
  }

  setAlias(id: string, alias: string | null): DeviceInfo | undefined {
    const existing = this.db
      .prepare(
        `SELECT id, label, alias, fingerprint, created_at, updated_at, last_seen_at,
                last_transport, last_device_class, revoked_at
           FROM devices WHERE id = ?`
      )
      .get(id) as DeviceRow | undefined
    if (!existing) return undefined
    const normalized = normalizeAlias(alias)
    const now = Date.now()
    this.db
      .prepare('UPDATE devices SET alias = ?, updated_at = ? WHERE id = ?')
      .run(normalized, now, id)
    return toInfo({ ...existing, alias: normalized, updated_at: now })
  }

  revokeDevice(id: string): DeviceInfo | undefined {
    const existing = this.db
      .prepare(
        `SELECT id, label, alias, fingerprint, created_at, updated_at, last_seen_at,
                last_transport, last_device_class, revoked_at
           FROM devices WHERE id = ?`
      )
      .get(id) as DeviceRow | undefined
    if (!existing) return undefined
    const now = Date.now()
    const write = this.db.transaction(() => {
      this.db
        .prepare('UPDATE devices SET revoked_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id)
      this.db.prepare('DELETE FROM device_keys WHERE device_id = ?').run(id)
    })
    write()
    return { ...toInfo(existing), revokedAt: now }
  }

  purgeDevice(id: string): DeviceInfo | undefined {
    const existing = this.db
      .prepare(
        `SELECT id, label, alias, fingerprint, created_at, updated_at, last_seen_at,
                last_transport, last_device_class, revoked_at
           FROM devices WHERE id = ?`
      )
      .get(id) as DeviceRow | undefined
    if (!existing) return undefined
    if (existing.revoked_at === null) {
      throw new DeviceStoreError('device_active', 'Revoke this device before deleting it')
    }
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM device_keys WHERE device_id = ?').run(id)
      this.db.prepare('DELETE FROM pairing_tokens WHERE used_device_id = ?').run(id)
      this.db.prepare('DELETE FROM devices WHERE id = ?').run(id)
    })
    write()
    return toInfo(existing)
  }

  revokeAllDevices(): number {
    const now = Date.now()
    const write = this.db.transaction(() => {
      const result = this.db
        .prepare('UPDATE devices SET revoked_at = ?, updated_at = ? WHERE revoked_at IS NULL')
        .run(now, now)
      this.db.prepare('DELETE FROM device_keys').run()
      this.db.prepare('DELETE FROM pairing_tokens').run()
      return result.changes
    })
    return write()
  }

  countActive(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM devices WHERE revoked_at IS NULL')
      .get() as { count: number }
    return row.count
  }

  touchDevice(id: string, meta: DeviceTouchMeta = {}): void {
    const now = Date.now()
    this.db
      .prepare(
        `UPDATE devices
            SET last_seen_at = ?, last_transport = COALESCE(?, last_transport),
                last_device_class = COALESCE(?, last_device_class)
          WHERE id = ? AND revoked_at IS NULL
            AND (last_seen_at IS NULL OR last_seen_at < ?)`
      )
      .run(now, meta.transport ?? null, meta.deviceClass ?? null, id, now - TOUCH_INTERVAL_MS)
  }

  pruneExpiredTokens(): number {
    return this.db
      .prepare('DELETE FROM pairing_tokens WHERE expires_at <= ? OR used_at IS NOT NULL')
      .run(Date.now()).changes
  }

  private consumeToken(id: string, deviceId: string): void {
    this.db
      .prepare(
        `UPDATE pairing_tokens
            SET used_at = COALESCE(used_at, ?), used_device_id = COALESCE(used_device_id, ?)
          WHERE id = ?`
      )
      .run(Date.now(), deviceId, id)
  }
}

function toInfo(row: DeviceRow): DeviceInfo {
  return {
    id: row.id,
    label: row.label,
    ...(row.alias ? { alias: row.alias } : {}),
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_seen_at !== null ? { lastSeenAt: row.last_seen_at } : {}),
    ...(row.last_transport ? { lastTransport: row.last_transport } : {}),
    ...(row.last_device_class ? { lastDeviceClass: row.last_device_class } : {}),
    ...(row.revoked_at !== null ? { revokedAt: row.revoked_at } : {}),
  }
}

function validateDeviceId(id: string): void {
  if (!DEVICE_ID_PATTERN.test(id)) {
    throw new DeviceStoreError('invalid_device', 'The device id is invalid')
  }
}

function normalizeLabel(value: string | undefined): string {
  const cleaned = Array.from(value ?? '')
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 0x20 || code === 0x7f ? ' ' : character
    })
    .join('')
  const label = cleaned.trim().slice(0, MAX_LABEL)
  return label || 'Unnamed device'
}

function normalizeAlias(value: string | null): string | null {
  if (value === null) return null
  const cleaned = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 0x20 || code === 0x7f ? ' ' : character
    })
    .join('')
  const alias = cleaned.trim().slice(0, MAX_DEVICE_ALIAS_LENGTH)
  return alias || null
}

function deviceAad(id: string): string {
  return `clara/device/${id}`
}

function pairingAad(id: string): string {
  return `clara/pairing/${id}`
}
