import { randomBytes } from 'node:crypto'
import type { PanelSessionStore } from '../store/panel-sessions.ts'
import { MemoryPanelSessionStore } from '../store/panel-sessions.ts'
import type { PanelUser, PanelUserStore } from '../store/panel-users.ts'
import {
  generateAdminToken,
  hashPassword,
  hashToken,
  tokenMatches,
  verifyPassword,
} from './password.ts'
import {
  readSetupToken,
  readSetupTokenFromEnv,
  removeSetupToken,
  setupTokenPath,
  writeSetupToken,
} from './setup-token.ts'

const SESSION_COOKIE = 'clara_panel_session'
const SESSION_BYTES = 32
const DEFAULT_IDLE_MS = 30 * 60_000
const DEFAULT_ABSOLUTE_MS = 12 * 60 * 60_000
/** A remembered session survives app restarts and long gaps between visits. */
const REMEMBER_IDLE_MS = 30 * 24 * 60 * 60_000
const REMEMBER_ABSOLUTE_MS = 90 * 24 * 60 * 60_000
const SETUP_TTL_MS = 24 * 60 * 60_000
const MAX_SESSIONS = 20
const LOGIN_WINDOW_MS = 10 * 60_000
const LOGIN_BLOCK_MS = 5 * 60_000
const MAX_LOGIN_FAILURES = 5
const SETUP_WINDOW_MS = 10 * 60_000
const SETUP_BLOCK_MS = 5 * 60_000
const MAX_SETUP_FAILURES = 10
const MIN_PASSWORD = 12
const MAX_PASSWORD = 1024
const MAX_USERNAME = 64

export type PanelRole = 'superadmin'

export type PanelAuthUser = {
  id: string
  username: string
  role: PanelRole
}

export type PanelAuthStatus =
  | {
      authenticated: false
      setupRequired: boolean
      setupTokenRequired: boolean
      resetPending: boolean
    }
  | { authenticated: true; user: PanelAuthUser }

export type PanelLoginResult = {
  token: string
  maxAgeSeconds: number
  /** The session should be kept across restarts until sign-out or revocation. */
  remember: boolean
  user: PanelAuthUser
}

export type PanelAuthOptions = {
  users: PanelUserStore
  configDir: string
  secureCookie?: boolean
  idleMs?: number
  absoluteMs?: number
  rememberIdleMs?: number
  rememberAbsoluteMs?: number
  /** Defaults to an in-memory store; the hub service passes the SQLite one. */
  sessions?: PanelSessionStore
  now?: () => number
}

type LoginAttempt = {
  failures: number
  windowStartedAt: number
  blockedUntil: number
}

export class PanelAuthError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfter?: number

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message)
    this.name = 'PanelAuthError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

/**
 * The panel's authentication gate. Passwords are stored as scrypt hashes; a
 * lost password is reset by a host-only command that writes a fresh one-time
 * setup token instead of exposing a network reset endpoint.
 */
export class PanelAuth {
  private readonly users: PanelUserStore
  private readonly configDir: string
  private readonly secureCookie: boolean
  private readonly idleMs: number
  private readonly absoluteMs: number
  private readonly rememberIdleMs: number
  private readonly rememberAbsoluteMs: number
  private readonly sessions: PanelSessionStore
  private readonly now: () => number
  private readonly attempts = new Map<string, LoginAttempt>()
  private readonly setupAttempts = new Map<string, LoginAttempt>()
  /** A host-supplied setup token is the only first-run form of authentication. */
  private setupTokenRequired = false

  constructor(options: PanelAuthOptions) {
    this.users = options.users
    this.configDir = options.configDir
    this.secureCookie = options.secureCookie === true
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS
    this.absoluteMs = options.absoluteMs ?? DEFAULT_ABSOLUTE_MS
    this.rememberIdleMs = options.rememberIdleMs ?? REMEMBER_IDLE_MS
    this.rememberAbsoluteMs = options.rememberAbsoluteMs ?? REMEMBER_ABSOLUTE_MS
    this.sessions = options.sessions ?? new MemoryPanelSessionStore()
    this.now = options.now ?? Date.now
    this.sessions.prune(this.now(), MAX_SESSIONS)
  }

  status(token: string | undefined): PanelAuthStatus {
    const session = this.session(token)
    if (session) return { authenticated: true, user: session }
    const configured = this.users.count() > 0
    return {
      authenticated: false,
      setupRequired: !configured,
      setupTokenRequired: !configured && this.setupTokenRequired,
      // A host reset issues a token for the existing admin. Report it so the
      // panel can offer the reset form instead of leaving the token unusable.
      resetPending: configured && this.users.hasUnexpiredSetupToken(this.now()),
    }
  }

  configured(): boolean {
    return this.users.count() > 0
  }

  requiresSetupToken(): boolean {
    return this.setupTokenRequired
  }

  /**
   * First-run setup is local-only by default: the panel is served on loopback
   * and no transport runs until the owner account exists. A host-supplied
   * token is required only when an operator explicitly provides one for a
   * remote or automated install.
   *
   * A host reset may issue a token while the server is stopped; keep it until
   * it is used or expires, and clear only stale resets.
   */
  ensureSetupToken(): { path?: string; fromEnv: boolean } | undefined {
    this.setupTokenRequired = false
    if (this.users.count() > 0) {
      const pending = readSetupToken(this.configDir)
      if (pending) {
        const stored = this.users.findSetupToken(hashToken(pending))
        if (stored && stored.expiresAt > this.now()) {
          return { path: setupTokenPath(this.configDir), fromEnv: false }
        }
      }
      this.users.clearSetupTokens()
      removeSetupToken(this.configDir)
      return undefined
    }

    const envToken = readSetupTokenFromEnv()
    if (envToken) {
      this.setupTokenRequired = true
      this.users.createSetupToken(hashToken(envToken), this.now() + SETUP_TTL_MS)
      removeSetupToken(this.configDir)
      return { fromEnv: true }
    }

    // Local setup needs no token. Drop any token left by an older build or a
    // host reset so the panel never asks for a code that is not required.
    this.users.clearSetupTokens()
    removeSetupToken(this.configDir)
    return undefined
  }

  async setup(
    token: string | undefined,
    username: string,
    password: string,
    source = 'unknown',
    remember = false
  ): Promise<PanelLoginResult> {
    this.assertSetupNotBlocked(source)
    try {
      const providedToken = token?.trim()
      if (providedToken || this.setupTokenRequired) {
        if (!providedToken || providedToken.length > 256) {
          throw new PanelAuthError(
            401,
            'setup_token_invalid',
            'The setup token is invalid or has expired'
          )
        }
        const record = this.users.findSetupToken(hashToken(providedToken))
        if (
          !record ||
          record.expiresAt <= this.now() ||
          !tokenMatches(providedToken, record.tokenHash)
        ) {
          throw new PanelAuthError(
            401,
            'setup_token_invalid',
            'The setup token is invalid or has expired'
          )
        }

        assertPassword(password)
        const hash = await hashPassword(password)

        let user: PanelUser
        if (record.userId) {
          const existing = this.users.findById(record.userId)
          if (!existing) {
            throw new PanelAuthError(
              401,
              'setup_token_invalid',
              'The setup token is no longer valid'
            )
          }
          this.users.updatePassword(existing.id, hash)
          user = this.users.findById(existing.id) as PanelUser
        } else {
          user = await this.createFirstUser(username, hash)
        }

        this.users.deleteSetupToken(record.tokenHash)
        removeSetupToken(this.configDir)
        this.users.touchLogin(user.id)
        this.clearSetupFailures(source)
        return this.createSession(user, remember)
      }

      if (this.users.count() > 0) {
        throw new PanelAuthError(409, 'already_configured', 'The panel already has an admin user')
      }
      assertPassword(password)
      const hash = await hashPassword(password)
      const user = await this.createFirstUser(username, hash)
      this.users.touchLogin(user.id)
      this.clearSetupFailures(source)
      return this.createSession(user, remember)
    } catch (cause) {
      this.recordSetupFailure(source)
      throw cause
    }
  }

  /**
   * Create the owner outside the HTTP flow, before transports start. Used by
   * `CLARA_ADMIN_*` for CI and by the CLI-only setup path.
   */
  async createOwner(username: string, password: string): Promise<PanelUser> {
    if (this.users.count() > 0) {
      throw new PanelAuthError(409, 'already_configured', 'The panel already has an admin user')
    }
    assertPassword(password)
    const hash = await hashPassword(password)
    const user = await this.createFirstUser(username, hash)
    this.users.touchLogin(user.id)
    return user
  }

  private async createFirstUser(username: string, passwordHash: string): Promise<PanelUser> {
    if (this.users.count() > 0) {
      throw new PanelAuthError(409, 'already_configured', 'The panel already has an admin user')
    }
    const name = normalizeUsername(username)
    if (this.users.findByUsername(name)) {
      throw new PanelAuthError(409, 'username_taken', 'That username is already in use')
    }
    const user = this.users.create(name, passwordHash)
    this.users.clearSetupTokens()
    removeSetupToken(this.configDir)
    return user
  }

  async login(
    username: string,
    password: string,
    source = 'unknown',
    remember = false
  ): Promise<PanelLoginResult> {
    this.assertNotBlocked(source, username)
    const name = username.trim()
    const user = this.users.findByUsername(name)
    if (!user) {
      // Keep the missing-user path expensive enough not to disclose existence.
      await hashPassword(password)
      this.recordFailure(source, name)
      throw new PanelAuthError(401, 'invalid_credentials', 'Invalid username or password')
    }
    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok || user.disabled) {
      this.recordFailure(source, name)
      throw new PanelAuthError(401, 'invalid_credentials', 'Invalid username or password')
    }

    this.clearFailures(source, name)
    this.users.touchLogin(user.id)
    return this.createSession(user, remember)
  }

  logout(token: string | undefined): void {
    if (!token) return
    this.sessions.delete(hashToken(token))
  }

  session(token: string | undefined): PanelAuthUser | undefined {
    if (!token) return undefined
    const tokenHash = hashToken(token)
    const session = this.sessions.find(tokenHash)
    if (!session) return undefined
    const now = this.now()
    if (now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
      this.sessions.delete(tokenHash)
      return undefined
    }
    const user = this.users.findById(session.userId)
    if (!user || user.disabled || user.sessionVersion !== session.sessionVersion) {
      this.sessions.delete(tokenHash)
      return undefined
    }
    const idleMs = session.remember ? this.rememberIdleMs : this.idleMs
    this.sessions.touch(tokenHash, now, now + idleMs)
    return publicUser(user)
  }

  /** Whether the current session was signed in with "keep me signed in". */
  isRemembered(token: string | undefined): boolean {
    if (!token) return false
    return this.sessions.find(hashToken(token))?.remember === true
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    nextPassword: string,
    remember = false
  ): Promise<PanelLoginResult> {
    const record = this.users.findByUsername(this.users.findById(userId)?.username ?? '')
    if (!record) throw new PanelAuthError(401, 'invalid_credentials', 'Sign in again')
    const ok = await verifyPassword(currentPassword, record.passwordHash)
    if (!ok) throw new PanelAuthError(401, 'invalid_credentials', 'The current password is wrong')
    assertPassword(nextPassword)
    const hash = await hashPassword(nextPassword)
    this.users.updatePassword(userId, hash)
    this.clearSessionsForUser(userId)
    const user = this.users.findById(userId) as PanelUser
    return this.createSession(user, remember)
  }

  /** Host-only reset used by `clara-server admin reset`. */
  resetForHost(): { token: string; path: string } {
    const existing = this.users.list()[0]
    const token = generateAdminToken()
    this.users.createSetupToken(hashToken(token), this.now() + SETUP_TTL_MS, existing?.id)
    if (existing) {
      this.users.nextSessionVersion(existing.id)
      this.clearSessionsForUser(existing.id)
    }
    const path = writeSetupToken(this.configDir, token)
    return { token, path }
  }

  cookieHeader(token: string, maxAgeSeconds: number): string {
    return serializeCookie(token, maxAgeSeconds, this.secureCookie)
  }

  clearCookieHeader(): string {
    return serializeCookie('', 0, this.secureCookie)
  }

  static cookieName = SESSION_COOKIE

  static readCookie(header: string | undefined): string | undefined {
    if (!header) return undefined
    for (const part of header.split(';')) {
      const index = part.indexOf('=')
      if (index < 0) continue
      const name = part.slice(0, index).trim()
      if (name !== SESSION_COOKIE) continue
      return decodeURIComponent(part.slice(index + 1).trim())
    }
    return undefined
  }

  /**
   * A tunnel request carries the session as a bearer token because the panel
   * cookie belongs to the panel origin, not the hub API origin. The cookie wins
   * when both are present so a server-served panel keeps its existing behavior.
   */
  static readBearer(header: string | undefined): string | undefined {
    if (!header) return undefined
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    return match?.[1]?.trim() || undefined
  }

  private createSession(user: PanelUser, remember: boolean): PanelLoginResult {
    const token = randomBytes(SESSION_BYTES).toString('base64url')
    const tokenHash = hashToken(token)
    const now = this.now()
    const idleMs = remember ? this.rememberIdleMs : this.idleMs
    const absoluteMs = remember ? this.rememberAbsoluteMs : this.absoluteMs
    this.sessions.create({
      tokenHash,
      userId: user.id,
      sessionVersion: user.sessionVersion,
      remember,
      createdAt: now,
      lastSeen: now,
      idleExpiresAt: now + idleMs,
      absoluteExpiresAt: now + absoluteMs,
    })
    this.sessions.prune(now, MAX_SESSIONS)
    return {
      token,
      maxAgeSeconds: Math.floor(absoluteMs / 1000),
      remember,
      user: publicUser(user),
    }
  }

  private clearSessionsForUser(userId: string): void {
    this.sessions.deleteForUser(userId)
  }

  private assertNotBlocked(source: string, username: string): void {
    const now = this.now()
    for (const key of [
      attemptKey('ip', source),
      attemptKey('user', username.trim().toLowerCase()),
    ]) {
      const attempt = this.attempts.get(key)
      if (attempt && attempt.blockedUntil > now) {
        throw new PanelAuthError(
          429,
          'rate_limited',
          'Too many sign-in attempts. Try again later.',
          Math.ceil((attempt.blockedUntil - now) / 1000)
        )
      }
    }
  }

  private recordFailure(source: string, username: string): void {
    const now = this.now()
    for (const key of [
      attemptKey('ip', source),
      attemptKey('user', username.trim().toLowerCase()),
    ]) {
      const previous = this.attempts.get(key)
      if (!previous || now - previous.windowStartedAt > LOGIN_WINDOW_MS) {
        this.attempts.set(key, { failures: 1, windowStartedAt: now, blockedUntil: 0 })
        continue
      }
      previous.failures += 1
      if (previous.failures >= MAX_LOGIN_FAILURES) {
        previous.blockedUntil = now + LOGIN_BLOCK_MS
      }
    }
    if (this.attempts.size > 500) {
      for (const [key, attempt] of this.attempts) {
        if (attempt.blockedUntil <= now && now - attempt.windowStartedAt > LOGIN_WINDOW_MS) {
          this.attempts.delete(key)
        }
      }
    }
  }

  private clearFailures(source: string, username: string): void {
    this.attempts.delete(attemptKey('ip', source))
    this.attempts.delete(attemptKey('user', username.trim().toLowerCase()))
  }

  private assertSetupNotBlocked(source: string): void {
    const now = this.now()
    const attempt = this.setupAttempts.get(source)
    if (attempt && attempt.blockedUntil > now) {
      throw new PanelAuthError(
        429,
        'rate_limited',
        'Too many setup attempts. Try again later.',
        Math.ceil((attempt.blockedUntil - now) / 1000)
      )
    }
  }

  private recordSetupFailure(source: string): void {
    const now = this.now()
    const previous = this.setupAttempts.get(source)
    if (!previous || now - previous.windowStartedAt > SETUP_WINDOW_MS) {
      this.setupAttempts.set(source, { failures: 1, windowStartedAt: now, blockedUntil: 0 })
      return
    }
    previous.failures += 1
    if (previous.failures >= MAX_SETUP_FAILURES) {
      previous.blockedUntil = now + SETUP_BLOCK_MS
    }
  }

  private clearSetupFailures(source: string): void {
    this.setupAttempts.delete(source)
  }
}

function publicUser(user: PanelUser): PanelAuthUser {
  return { id: user.id, username: user.username, role: 'superadmin' }
}

function normalizeUsername(value: string): string {
  const name = value.trim()
  if (!name || name.length > MAX_USERNAME) {
    throw new PanelAuthError(
      400,
      'invalid_username',
      `Use a username up to ${MAX_USERNAME} characters`
    )
  }
  if (hasControlCharacters(name)) {
    throw new PanelAuthError(400, 'invalid_username', 'The username contains control characters')
  }
  return name
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function assertPassword(value: string): void {
  if (typeof value !== 'string' || value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) {
    throw new PanelAuthError(
      400,
      'invalid_password',
      `Use a password between ${MIN_PASSWORD} and ${MAX_PASSWORD} characters`
    )
  }
}

function attemptKey(kind: 'ip' | 'user', value: string): string {
  return `${kind}:${value}`
}

function serializeCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ]
  if (maxAgeSeconds <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  if (secure) parts.push('Secure')
  return parts.join('; ')
}
