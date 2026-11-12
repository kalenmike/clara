import { randomUUID } from 'node:crypto'
import {
  bytesToBase64Url,
  fingerprintKey,
  generateKey,
  openSecret,
  randomBytes,
  sealSecret,
} from '@clara/crypto'
import type { ClaraDatabase } from '../store/database.ts'
import {
  HarnessValidationError,
  type AdapterCredential,
  type HarnessConnection,
  type HarnessPairing,
  type HarnessTransport,
} from './types.ts'

export type HarnessStoreOptions = {
  db: ClaraDatabase
  key: CryptoKey
  keyVersion: number
}

type ConnectionRow = {
  id: string
  harness_id: string
  kind: string
  label: string
  transport: HarnessTransport | null
  online: number
  adapter_version: string | null
  protocol_version: number | null
  harness_version: string | null
  capabilities_json: string | null
  is_active: number
  last_test_at: number | null
  last_test_ok: number | null
  last_test_error: string | null
  last_seen_at: number | null
  created_at: number
  updated_at: number
  credential_id: string | null
  credential_fingerprint: string | null
}

type SecretRow = {
  ciphertext: Buffer
  nonce: Buffer
  key_version: number
}

type CredentialRow = SecretRow & {
  adapter_id: string
  harness_id: string
  fingerprint: string
  created_at: number
  revoked_at: number | null
}

type PairingRow = SecretRow & {
  id: string
  kind: string
  label: string
  fingerprint: string
  created_at: number
  expires_at: number
  used_at: number | null
  used_harness_id: string | null
}

const PAIRING_TTL_MS = 10 * 60_000
const MAX_PENDING_PAIRINGS = 8

export type EnrollAdapterInput = {
  pairId: string
  pairToken: string
  harnessId: string
  kind: string
  label: string
  adapterId: string
  key: string
  adapterVersion: string
  protocolVersion: number
  harnessVersion?: string
  capabilities: Record<string, unknown>
  transport: HarnessTransport
}

export type EnrollAdapterResult = {
  connection: HarnessConnection
  reconnected: boolean
}

export class HarnessStore {
  private readonly db: ClaraDatabase
  private readonly key: CryptoKey
  private readonly keyVersion: number

  constructor(options: HarnessStoreOptions) {
    this.db = options.db
    this.key = options.key
    this.keyVersion = options.keyVersion
  }

  list(): HarnessConnection[] {
    const rows = this.db
      .prepare(`${selectConnection} ORDER BY c.is_active DESC, c.created_at ASC`)
      .all() as ConnectionRow[]
    return rows.map(toConnection)
  }

  get(id: string): HarnessConnection | undefined {
    const row = this.db.prepare(`${selectConnection} WHERE c.id = ?`).get(id) as
      ConnectionRow | undefined
    return row ? toConnection(row) : undefined
  }

  active(): HarnessConnection | undefined {
    const row = this.db.prepare(`${selectConnection} WHERE c.is_active = 1`).get() as
      ConnectionRow | undefined
    return row ? toConnection(row) : undefined
  }

  findCredential(adapterId: string): AdapterCredential | undefined {
    const row = this.db
      .prepare(
        `SELECT adapter_id, harness_id, fingerprint, created_at, revoked_at,
                key_ciphertext AS ciphertext, key_nonce AS nonce, key_version
           FROM adapter_credentials WHERE adapter_id = ?`
      )
      .get(adapterId) as CredentialRow | undefined
    if (!row) return undefined
    return {
      adapterId: row.adapter_id,
      harnessId: row.harness_id,
      label: row.harness_id,
      key: '',
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      ...(row.revoked_at !== null ? { revokedAt: row.revoked_at } : {}),
    }
  }

  async credential(adapterId: string): Promise<AdapterCredential | undefined> {
    const row = this.db
      .prepare(
        `SELECT adapter_id, harness_id, fingerprint, created_at, revoked_at,
                key_ciphertext AS ciphertext, key_nonce AS nonce, key_version
           FROM adapter_credentials WHERE adapter_id = ?`
      )
      .get(adapterId) as CredentialRow | undefined
    if (!row || row.revoked_at !== null) return undefined
    if (row.key_version !== this.keyVersion) return undefined
    const key = await openSecret(this.key, credentialAad(row.adapter_id), {
      iv: row.nonce.toString('base64url'),
      ct: row.ciphertext.toString('base64url'),
    })
    return {
      adapterId: row.adapter_id,
      harnessId: row.harness_id,
      label: row.harness_id,
      key,
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
    }
  }

  setActive(id: string): HarnessConnection {
    const update = this.db.transaction(() => {
      this.db.prepare('UPDATE harness_connections SET is_active = 0 WHERE is_active = 1').run()
      const result = this.db
        .prepare('UPDATE harness_connections SET is_active = 1, updated_at = ? WHERE id = ?')
        .run(Date.now(), id)
      if (result.changes === 0) {
        throw new HarnessValidationError('not_found', 'That harness connection no longer exists')
      }
    })
    update()
    return this.get(id) as HarnessConnection
  }

  remove(id: string): void {
    const result = this.db.prepare('DELETE FROM harness_connections WHERE id = ?').run(id)
    if (result.changes === 0) {
      throw new HarnessValidationError('not_found', 'That harness connection no longer exists')
    }
  }

  forget(id: string): void {
    const connection = this.get(id)
    if (!connection) {
      throw new HarnessValidationError('not_found', 'That harness connection no longer exists')
    }
    const write = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM harness_connections WHERE harness_id = ?')
        .run(connection.harnessId)
      this.db
        .prepare('DELETE FROM adapter_credentials WHERE harness_id = ?')
        .run(connection.harnessId)
      this.db
        .prepare('DELETE FROM harness_identities WHERE harness_id = ?')
        .run(connection.harnessId)
    })
    write()
  }

  recordTest(id: string, ok: boolean, error?: string): void {
    this.db
      .prepare(
        `UPDATE harness_connections
            SET last_test_at = ?, last_test_ok = ?, last_test_error = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(Date.now(), ok ? 1 : 0, error ?? null, Date.now(), id)
  }

  setOnline(harnessId: string, online: boolean): void {
    this.db
      .prepare(
        `UPDATE harness_connections
            SET online = ?, last_seen_at = ?, updated_at = ?
          WHERE harness_id = ?`
      )
      .run(online ? 1 : 0, Date.now(), Date.now(), harnessId)
  }

  /**
   * Online is live-session state, not saved configuration. Clear it when the
   * hub starts so a stopped adapter cannot look online from a previous run.
   */
  resetOnline(): void {
    this.db
      .prepare(
        `UPDATE harness_connections
            SET online = 0, updated_at = ?
          WHERE online = 1`
      )
      .run(Date.now())
  }

  async createPairing(input: { kind: string; label: string }): Promise<HarnessPairing> {
    this.db
      .prepare(
        `DELETE FROM harness_pairings
          WHERE used_at IS NOT NULL OR expires_at <= ?`
      )
      .run(Date.now())
    const pending = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM harness_pairings WHERE used_at IS NULL AND expires_at > ?'
      )
      .get(Date.now()) as { count: number }
    if (pending.count >= MAX_PENDING_PAIRINGS) {
      throw new HarnessValidationError(
        'too_many_pairings',
        'Too many harness pairing codes are waiting. Cancel one in the panel.'
      )
    }

    const id = bytesToBase64Url(randomBytes(16))
    const token = generateKey()
    const fingerprint = await fingerprintKey(token)
    const now = Date.now()
    const box = await sealSecret(this.key, pairingAad(id), token)
    this.db
      .prepare(
        `INSERT INTO harness_pairings
           (id, kind, label, token_ciphertext, token_nonce, key_version, fingerprint,
            created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.kind,
        input.label,
        Buffer.from(box.ct, 'base64url'),
        Buffer.from(box.iv, 'base64url'),
        this.keyVersion,
        fingerprint,
        now,
        now + PAIRING_TTL_MS
      )
    return {
      id,
      kind: input.kind,
      label: input.label,
      token,
      fingerprint,
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
    }
  }

  listPairings(): HarnessPairing[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, label, fingerprint, created_at, expires_at,
                token_ciphertext AS ciphertext, token_nonce AS nonce, key_version, used_at
           FROM harness_pairings
          WHERE used_at IS NULL AND expires_at > ?
          ORDER BY created_at ASC`
      )
      .all(Date.now()) as PairingRow[]
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: row.label,
      token: '',
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }))
  }

  async pairingToken(id: string): Promise<string | undefined> {
    const row = this.db
      .prepare(
        `SELECT id, token_ciphertext AS ciphertext, token_nonce AS nonce,
                key_version, fingerprint, expires_at, used_at
           FROM harness_pairings
          WHERE id = ? AND expires_at > ?`
      )
      .get(id, Date.now()) as PairingRow | undefined
    if (!row || row.key_version !== this.keyVersion) return undefined
    return openSecret(this.key, pairingAad(row.id), {
      iv: row.nonce.toString('base64url'),
      ct: row.ciphertext.toString('base64url'),
    })
  }

  cancelPairing(id: string): void {
    this.db.prepare('DELETE FROM harness_pairings WHERE id = ?').run(id)
  }

  async enroll(input: EnrollAdapterInput): Promise<EnrollAdapterResult> {
    const pairing = this.db
      .prepare(
        `SELECT id, kind, label, token_ciphertext AS ciphertext, token_nonce AS nonce,
                key_version, fingerprint, created_at, expires_at,
                used_at, used_harness_id
           FROM harness_pairings WHERE id = ?`
      )
      .get(input.pairId) as PairingRow | undefined
    if (!pairing || pairing.expires_at <= Date.now()) {
      throw new HarnessValidationError('pairing_invalid', 'The pairing code is invalid or expired')
    }
    if (pairing.key_version !== this.keyVersion) {
      throw new HarnessValidationError('pairing_invalid', 'The pairing code cannot be opened')
    }
    const token = await openSecret(this.key, pairingAad(pairing.id), {
      iv: pairing.nonce.toString('base64url'),
      ct: pairing.ciphertext.toString('base64url'),
    })
    if (token !== input.pairToken) {
      throw new HarnessValidationError('pairing_invalid', 'The pairing code is invalid')
    }
    if (pairing.kind !== input.kind) {
      throw new HarnessValidationError(
        'pairing_kind',
        `This code is for ${pairing.kind}, not ${input.kind}`
      )
    }

    if (pairing.used_at !== null) {
      if (pairing.used_harness_id !== input.harnessId) {
        throw new HarnessValidationError('pairing_used', 'This pairing code has already been used')
      }
      const credential = await this.credential(input.adapterId)
      if (!credential || credential.harnessId !== input.harnessId || credential.key !== input.key) {
        throw new HarnessValidationError(
          'pairing_invalid',
          'The pairing retry credentials do not match'
        )
      }
      const connection = this.db
        .prepare('SELECT id FROM harness_connections WHERE harness_id = ?')
        .get(input.harnessId) as { id: string } | undefined
      if (!connection) {
        throw new HarnessValidationError('pairing_invalid', 'The paired connection is missing')
      }
      return { connection: this.get(connection.id) as HarnessConnection, reconnected: true }
    }

    const now = Date.now()
    const keyBox = await sealSecret(this.key, credentialAad(input.adapterId), input.key)
    const fingerprint = await fingerprintKey(input.key)
    const existingConnection = this.db
      .prepare('SELECT id, harness_id FROM harness_connections WHERE harness_id = ?')
      .get(input.harnessId) as { id: string; harness_id: string } | undefined
    const connectionID = existingConnection?.id ?? randomUUID()
    const currentActive = this.active()
    const activateOnEnroll = currentActive === undefined || !currentActive.credentialConfigured

    const write = this.db.transaction(() => {
      if (activateOnEnroll) {
        this.db.prepare('UPDATE harness_connections SET is_active = 0 WHERE is_active = 1').run()
      }
      this.db
        .prepare(
          `INSERT INTO harness_identities (harness_id, kind, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(harness_id) DO UPDATE SET
             kind = excluded.kind,
             last_seen_at = excluded.last_seen_at,
             retired_at = NULL`
        )
        .run(input.harnessId, input.kind, now, now)

      this.db
        .prepare(
          `INSERT INTO adapter_credentials
             (adapter_id, harness_id, key_ciphertext, key_nonce, key_version, fingerprint, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(adapter_id) DO UPDATE SET
             harness_id = excluded.harness_id,
             key_ciphertext = excluded.key_ciphertext,
             key_nonce = excluded.key_nonce,
             key_version = excluded.key_version,
             fingerprint = excluded.fingerprint,
             revoked_at = NULL`
        )
        .run(
          input.adapterId,
          input.harnessId,
          Buffer.from(keyBox.ct, 'base64url'),
          Buffer.from(keyBox.iv, 'base64url'),
          this.keyVersion,
          fingerprint,
          now
        )

      if (existingConnection) {
        this.db
          .prepare(
            `UPDATE harness_connections
                SET harness_id = ?, kind = ?, label = ?, transport = ?, online = 0,
                    adapter_version = ?, protocol_version = ?, harness_version = ?,
                    capabilities_json = ?, credential_id = ?, last_seen_at = ?, updated_at = ?
              WHERE id = ?`
          )
          .run(
            input.harnessId,
            input.kind,
            input.label || pairing.label,
            input.transport,
            input.adapterVersion,
            input.protocolVersion,
            input.harnessVersion ?? null,
            JSON.stringify(input.capabilities),
            input.adapterId,
            now,
            now,
            connectionID
          )
      } else {
        const takeActive = activateOnEnroll
        this.db
          .prepare(
            `INSERT INTO harness_connections
               (id, kind, label, is_active, created_at, updated_at, harness_id, credential_id,
                transport, online, adapter_version, protocol_version, harness_version,
                capabilities_json, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
          )
          .run(
            connectionID,
            input.kind,
            input.label || pairing.label,
            takeActive ? 1 : 0,
            now,
            now,
            input.harnessId,
            input.adapterId,
            input.transport,
            input.adapterVersion,
            input.protocolVersion,
            input.harnessVersion ?? null,
            JSON.stringify(input.capabilities),
            now
          )
      }

      this.db
        .prepare('UPDATE harness_pairings SET used_at = ?, used_harness_id = ? WHERE id = ?')
        .run(now, input.harnessId, input.pairId)
    })
    write()
    if (activateOnEnroll && existingConnection) this.setActive(connectionID)

    return {
      connection: this.get(connectionID) as HarnessConnection,
      reconnected: existingConnection !== undefined,
    }
  }

  async redactionValues(): Promise<string[]> {
    const values: string[] = []
    const credentials = this.db
      .prepare(
        `SELECT adapter_id, key_ciphertext AS ciphertext, key_nonce AS nonce, key_version
           FROM adapter_credentials`
      )
      .all() as Array<SecretRow & { adapter_id: string }>
    for (const row of credentials) {
      if (row.key_version !== this.keyVersion) continue
      try {
        values.push(
          await openSecret(this.key, credentialAad(row.adapter_id), {
            iv: row.nonce.toString('base64url'),
            ct: row.ciphertext.toString('base64url'),
          })
        )
      } catch {
        // A key mismatch must not prevent the panel from loading.
      }
    }
    return values
  }
}

const selectConnection = `
  SELECT c.id, c.harness_id, c.kind, c.label, c.transport, c.online,
         c.adapter_version, c.protocol_version, c.harness_version, c.capabilities_json,
         c.is_active, c.last_test_at, c.last_test_ok, c.last_test_error,
         c.last_seen_at, c.created_at, c.updated_at, c.credential_id,
         ac.fingerprint AS credential_fingerprint
    FROM harness_connections c
    LEFT JOIN adapter_credentials ac ON ac.adapter_id = c.credential_id`

function toConnection(row: ConnectionRow): HarnessConnection {
  return {
    id: row.id,
    harnessId: row.harness_id,
    kind: row.kind,
    label: row.label,
    transport: row.transport === 'relay' ? 'relay' : 'local',
    online: row.online === 1,
    ...(row.credential_fingerprint ? { fingerprint: row.credential_fingerprint } : {}),
    ...(row.adapter_version ? { adapterVersion: row.adapter_version } : {}),
    ...(row.protocol_version !== null ? { protocolVersion: row.protocol_version } : {}),
    ...(row.harness_version ? { harnessVersion: row.harness_version } : {}),
    capabilities: parseObject(row.capabilities_json),
    isActive: row.is_active === 1,
    credentialConfigured: row.credential_id !== null,
    ...(row.last_test_at !== null ? { lastTestAt: row.last_test_at } : {}),
    ...(row.last_test_ok !== null ? { lastTestOk: row.last_test_ok === 1 } : {}),
    ...(row.last_test_error ? { lastTestError: row.last_test_error } : {}),
    ...(row.last_seen_at !== null ? { lastSeenAt: row.last_seen_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function credentialAad(adapterId: string): string {
  return `clara/v1|adapter|${adapterId}|key`
}

function pairingAad(id: string): string {
  return `clara/v1|harness-pairing|${id}|token`
}
