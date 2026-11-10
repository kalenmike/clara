import { randomUUID } from 'node:crypto'
import { openSecret, sealSecret } from '@clara/crypto'
import type { ClaraDatabase } from '../store/database.ts'
import { HarnessValidationError, type HarnessConnection } from './types.ts'
import { validateHarnessInput } from './validation.ts'

export type HarnessStoreOptions = {
  db: ClaraDatabase
  key: CryptoKey
  keyVersion: number
}

type HarnessRow = {
  id: string
  kind: 'opencode'
  label: string
  base_url: string
  auth_type: 'none' | 'basic'
  username: string | null
  options_json: string
  is_active: number
  last_test_at: number | null
  last_test_ok: number | null
  last_test_error: string | null
  created_at: number
  updated_at: number
  secret_configured: number
}

type SecretRow = {
  ciphertext: Buffer
  nonce: Buffer
  key_version: number
}

const PASSWORD_FIELD = 'password'

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
      .prepare(`${selectConnection} ORDER BY is_active DESC, created_at ASC`)
      .all() as HarnessRow[]
    return rows.map(toConnection)
  }

  get(id: string): HarnessConnection | undefined {
    const row = this.db.prepare(`${selectConnection} WHERE c.id = ?`).get(id) as
      HarnessRow | undefined
    return row ? toConnection(row) : undefined
  }

  active(): HarnessConnection | undefined {
    const row = this.db.prepare(`${selectConnection} WHERE c.is_active = 1`).get() as
      HarnessRow | undefined
    return row ? toConnection(row) : undefined
  }

  async save(value: unknown, id?: string): Promise<HarnessConnection> {
    const existing = id ? this.get(id) : undefined
    if (id && !existing) {
      throw new HarnessValidationError('not_found', 'That harness connection no longer exists')
    }

    const hasSecret = id ? this.hasSecret(id, PASSWORD_FIELD) : false
    const candidate = validateHarnessInput(value, { hasSecret })
    const now = Date.now()
    const connectionID = id ?? randomUUID()

    let secret: SecretRow | undefined
    if (candidate.authType === 'basic' && candidate.password) {
      const box = await sealSecret(
        this.key,
        secretAad(connectionID, PASSWORD_FIELD),
        candidate.password
      )
      secret = {
        ciphertext: Buffer.from(box.ct, 'base64url'),
        nonce: Buffer.from(box.iv, 'base64url'),
        key_version: this.keyVersion,
      }
    }

    const write = this.db.transaction(() => {
      if (existing) {
        this.db
          .prepare(
            `UPDATE harness_connections
                SET kind = ?, label = ?, base_url = ?, auth_type = ?, username = ?,
                    options_json = ?, updated_at = ?
              WHERE id = ?`
          )
          .run(
            candidate.kind,
            candidate.label,
            candidate.baseUrl,
            candidate.authType,
            candidate.username ?? null,
            JSON.stringify(candidate.options ?? {}),
            now,
            connectionID
          )
      } else {
        const takeActive = this.active() === undefined
        this.db
          .prepare(
            `INSERT INTO harness_connections
               (id, kind, label, base_url, auth_type, username, options_json,
                is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            connectionID,
            candidate.kind,
            candidate.label,
            candidate.baseUrl,
            candidate.authType,
            candidate.username ?? null,
            JSON.stringify(candidate.options ?? {}),
            takeActive ? 1 : 0,
            now,
            now
          )
      }

      if (candidate.authType === 'none') {
        this.db.prepare('DELETE FROM harness_secrets WHERE connection_id = ?').run(connectionID)
      } else if (secret) {
        this.db
          .prepare(
            `INSERT INTO harness_secrets
               (connection_id, field, ciphertext, nonce, key_version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (connection_id, field) DO UPDATE SET
               ciphertext = excluded.ciphertext,
               nonce = excluded.nonce,
               key_version = excluded.key_version,
               updated_at = excluded.updated_at`
          )
          .run(
            connectionID,
            PASSWORD_FIELD,
            secret.ciphertext,
            secret.nonce,
            secret.key_version,
            now
          )
      }
    })
    write()

    return this.get(connectionID) as HarnessConnection
  }

  remove(id: string): void {
    const result = this.db.prepare('DELETE FROM harness_connections WHERE id = ?').run(id)
    if (result.changes === 0) {
      throw new HarnessValidationError('not_found', 'That harness connection no longer exists')
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

  recordTest(id: string, ok: boolean, error?: string): void {
    this.db
      .prepare(
        `UPDATE harness_connections
            SET last_test_at = ?, last_test_ok = ?, last_test_error = ?, updated_at = ?
          WHERE id = ?`
      )
      .run(Date.now(), ok ? 1 : 0, error ?? null, Date.now(), id)
  }

  hasSecret(id: string, field = PASSWORD_FIELD): boolean {
    const row = this.db
      .prepare('SELECT 1 AS present FROM harness_secrets WHERE connection_id = ? AND field = ?')
      .get(id, field) as { present: number } | undefined
    return row !== undefined
  }

  async secret(id: string, field = PASSWORD_FIELD): Promise<string | undefined> {
    const row = this.db
      .prepare(
        'SELECT ciphertext, nonce, key_version FROM harness_secrets WHERE connection_id = ? AND field = ?'
      )
      .get(id, field) as SecretRow | undefined
    if (!row) return undefined
    if (row.key_version !== this.keyVersion) {
      throw new Error(`The stored ${field} uses an unavailable secret-key version`)
    }
    return openSecret(this.key, secretAad(id, field), {
      iv: row.nonce.toString('base64url'),
      ct: row.ciphertext.toString('base64url'),
    })
  }

  async activeSecret(): Promise<{ connection: HarnessConnection; password?: string } | undefined> {
    const connection = this.active()
    if (!connection) return undefined
    const password = await this.secret(connection.id)
    return { connection, ...(password ? { password } : {}) }
  }

  async redactionValues(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT connection_id, field, ciphertext, nonce, key_version FROM harness_secrets')
      .all() as Array<SecretRow & { connection_id: string; field: string }>
    const values: string[] = []
    for (const row of rows) {
      if (row.key_version !== this.keyVersion) continue
      try {
        values.push(
          await openSecret(this.key, secretAad(row.connection_id, row.field), {
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
  SELECT c.id, c.kind, c.label, c.base_url, c.auth_type, c.username, c.options_json,
         c.is_active, c.last_test_at, c.last_test_ok, c.last_test_error,
         c.created_at, c.updated_at,
         EXISTS(
           SELECT 1 FROM harness_secrets s
            WHERE s.connection_id = c.id AND s.field = '${PASSWORD_FIELD}'
         ) AS secret_configured
    FROM harness_connections c`

function toConnection(row: HarnessRow): HarnessConnection {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    baseUrl: row.base_url,
    authType: row.auth_type,
    ...(row.username ? { username: row.username } : {}),
    options: parseOptions(row.options_json),
    isActive: row.is_active === 1,
    ...(row.last_test_at !== null ? { lastTestAt: row.last_test_at } : {}),
    ...(row.last_test_ok !== null ? { lastTestOk: row.last_test_ok === 1 } : {}),
    ...(row.last_test_error ? { lastTestError: row.last_test_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretConfigured: row.secret_configured === 1,
  }
}

function parseOptions(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function secretAad(id: string, field: string): string {
  return `clara/v1|harness|${id}|${field}`
}
