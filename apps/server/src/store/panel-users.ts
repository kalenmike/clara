import { randomUUID } from 'node:crypto'
import type { ClaraDatabase } from './database.ts'

export type PanelRole = 'superadmin'

export type PanelUser = {
  id: string
  username: string
  role: PanelRole
  disabled: boolean
  sessionVersion: number
  createdAt: number
  updatedAt: number
  lastLoginAt?: number
}

export type PanelUserRecord = PanelUser & {
  passwordHash: string
}

export type PanelSetupToken = {
  tokenHash: string
  userId?: string
  expiresAt: number
  createdAt: number
}

type UserRow = {
  id: string
  username: string
  password_hash: string
  role: PanelRole
  disabled: number
  session_version: number
  created_at: number
  updated_at: number
  last_login_at: number | null
}

type TokenRow = {
  token_hash: string
  user_id: string | null
  expires_at: number
  created_at: number
}

export class PanelUserStore {
  private readonly db: ClaraDatabase

  constructor(db: ClaraDatabase) {
    this.db = db
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM panel_users').get() as {
      count: number
    }
    return row.count
  }

  list(): PanelUser[] {
    const rows = this.db
      .prepare('SELECT * FROM panel_users ORDER BY created_at ASC')
      .all() as UserRow[]
    return rows.map(toUser)
  }

  findByUsername(username: string): PanelUserRecord | undefined {
    const row = this.db.prepare('SELECT * FROM panel_users WHERE username = ?').get(username) as
      UserRow | undefined
    return row ? toRecord(row) : undefined
  }

  findById(id: string): PanelUser | undefined {
    const row = this.db.prepare('SELECT * FROM panel_users WHERE id = ?').get(id) as
      UserRow | undefined
    return row ? toUser(row) : undefined
  }

  create(username: string, passwordHash: string, role: PanelRole = 'superadmin'): PanelUser {
    const now = Date.now()
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO panel_users
           (id, username, password_hash, role, disabled, session_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
      )
      .run(id, username, passwordHash, role, now, now)
    return this.findById(id) as PanelUser
  }

  updatePassword(id: string, passwordHash: string): number {
    const version = this.nextSessionVersion(id)
    this.db
      .prepare(
        'UPDATE panel_users SET password_hash = ?, session_version = ?, updated_at = ? WHERE id = ?'
      )
      .run(passwordHash, version, Date.now(), id)
    return version
  }

  nextSessionVersion(id: string): number {
    const row = this.db
      .prepare(
        `UPDATE panel_users
            SET session_version = session_version + 1, updated_at = ?
          WHERE id = ?
      RETURNING session_version`
      )
      .get(Date.now(), id) as { session_version: number } | undefined
    return row?.session_version ?? 0
  }

  touchLogin(id: string): void {
    this.db
      .prepare('UPDATE panel_users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(Date.now(), Date.now(), id)
  }

  createSetupToken(tokenHash: string, expiresAt: number, userId?: string): void {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM panel_setup_tokens').run()
      this.db
        .prepare(
          'INSERT INTO panel_setup_tokens (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(tokenHash, userId ?? null, expiresAt, Date.now())
    })
    write()
  }

  findSetupToken(tokenHash: string): PanelSetupToken | undefined {
    const row = this.db
      .prepare('SELECT * FROM panel_setup_tokens WHERE token_hash = ?')
      .get(tokenHash) as TokenRow | undefined
    if (!row) return undefined
    return {
      tokenHash: row.token_hash,
      ...(row.user_id ? { userId: row.user_id } : {}),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }
  }

  deleteSetupToken(tokenHash: string): void {
    this.db.prepare('DELETE FROM panel_setup_tokens WHERE token_hash = ?').run(tokenHash)
  }

  clearSetupTokens(): void {
    this.db.prepare('DELETE FROM panel_setup_tokens').run()
  }
}

function toUser(row: UserRow): PanelUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    disabled: row.disabled === 1,
    sessionVersion: row.session_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_login_at !== null ? { lastLoginAt: row.last_login_at } : {}),
  }
}

function toRecord(row: UserRow): PanelUserRecord {
  return { ...toUser(row), passwordHash: row.password_hash }
}
