import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelAuth, PanelAuthError } from '../src/panel/auth.ts'
import { readSetupToken } from '../src/panel/setup-token.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'
import { SqlitePanelSessionStore } from '../src/store/panel-sessions.ts'
import { PanelUserStore } from '../src/store/panel-users.ts'

let dir: string
let db: ClaraDatabase
let users: PanelUserStore
let auth: PanelAuth

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clara-panel-auth-'))
  db = openDatabase(join(dir, 'clara.db'))
  users = new PanelUserStore(db)
  auth = new PanelAuth({ users, configDir: dir })
})

afterEach(() => {
  closeDatabase(db)
  rmSync(dir, { recursive: true, force: true })
})

describe('panel auth', () => {
  it('starts local setup without a token file', () => {
    const setup = auth.ensureSetupToken()
    expect(setup).toBeUndefined()
    expect(readSetupToken(dir)).toBeUndefined()
    expect(auth.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: true,
      setupTokenRequired: false,
      resetPending: false,
    })
  })

  it('creates the first owner with a strong password and no token', async () => {
    await expect(auth.setup(undefined, 'admin', 'short')).rejects.toMatchObject({
      code: 'invalid_password',
    })

    const login = await auth.setup(undefined, 'admin', 'a-long-password')
    expect(login.user).toMatchObject({ username: 'admin', role: 'superadmin' })
    expect(auth.session(login.token)).toMatchObject({ username: 'admin' })
    expect(users.count()).toBe(1)
    expect(auth.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: false,
      setupTokenRequired: false,
      resetPending: false,
    })
  })

  it('requires a host token only when one is configured', async () => {
    process.env.CLARA_ADMIN_SETUP_TOKEN = 'host-supplied-setup-token'
    try {
      const tokenAuth = new PanelAuth({ users, configDir: dir })
      expect(tokenAuth.ensureSetupToken()).toMatchObject({ fromEnv: true })
      expect(tokenAuth.status(undefined)).toMatchObject({
        setupRequired: true,
        setupTokenRequired: true,
      })

      await expect(tokenAuth.setup(undefined, 'admin', 'a-long-password')).rejects.toMatchObject({
        code: 'setup_token_invalid',
      })
      await expect(
        tokenAuth.setup('wrong-token', 'admin', 'a-long-password')
      ).rejects.toBeInstanceOf(PanelAuthError)

      const login = await tokenAuth.setup('host-supplied-setup-token', 'admin', 'a-long-password')
      expect(tokenAuth.session(login.token)).toBeTruthy()
    } finally {
      delete process.env.CLARA_ADMIN_SETUP_TOKEN
    }
  })

  it('creates the owner outside the HTTP setup flow', async () => {
    const owner = await auth.createOwner('owner', 'a-long-password')
    expect(owner).toMatchObject({ username: 'owner', role: 'superadmin' })
    expect(auth.configured()).toBe(true)
    await expect(auth.createOwner('second', 'a-long-password')).rejects.toMatchObject({
      code: 'already_configured',
    })
  })

  it('logs in, rejects a wrong password, and signs out', async () => {
    await auth.setup(undefined, 'admin', 'a-long-password')

    const login = await auth.login('admin', 'a-long-password', '127.0.0.1')
    expect(auth.session(login.token)).toBeTruthy()
    auth.logout(login.token)
    expect(auth.session(login.token)).toBeUndefined()

    await expect(auth.login('admin', 'not-the-password', '127.0.0.1')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('rate limits repeated login failures', async () => {
    await auth.setup(undefined, 'admin', 'a-long-password')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(auth.login('admin', 'bad-password', '10.0.0.5')).rejects.toMatchObject({
        code: 'invalid_credentials',
      })
    }
    await expect(auth.login('admin', 'bad-password', '10.0.0.5')).rejects.toMatchObject({
      code: 'rate_limited',
    })
  })

  it('resets a lost password with a host token and revokes sessions', async () => {
    const login = await auth.setup(undefined, 'admin', 'a-long-password')
    expect(auth.session(login.token)).toBeTruthy()

    const reset = auth.resetForHost()
    expect(auth.session(login.token)).toBeUndefined()
    expect(reset.token).toBeTruthy()
    expect(auth.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: false,
      setupTokenRequired: false,
      resetPending: true,
    })

    // The reset form omits the username because the token is bound to the
    // existing account; the empty value must not create a second user.
    const next = await auth.setup(reset.token, '', 'another-long-password')
    expect(auth.session(next.token)).toBeTruthy()
    expect(users.count()).toBe(1)
    expect(auth.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: false,
      setupTokenRequired: false,
      resetPending: false,
    })
  })

  it('hides a reset once its token expires', async () => {
    await auth.setup(undefined, 'admin', 'a-long-password')
    auth.resetForHost()

    const later = new PanelAuth({
      users,
      configDir: dir,
      now: () => Date.now() + 25 * 60 * 60_000,
    })
    expect(later.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: false,
      setupTokenRequired: false,
      resetPending: false,
    })
  })

  it('keeps a host reset token across an agent restart', async () => {
    await auth.setup(undefined, 'admin', 'a-long-password')
    const reset = auth.resetForHost()

    const restarted = new PanelAuth({ users, configDir: dir })
    expect(restarted.ensureSetupToken()?.path).toBeTruthy()
    expect(restarted.status(undefined)).toMatchObject({ resetPending: true })
    const next = await restarted.setup(reset.token, 'admin', 'another-long-password')
    expect(restarted.session(next.token)).toBeTruthy()
  })

  it('changes the password and revokes the previous session', async () => {
    const login = await auth.setup(undefined, 'admin', 'a-long-password')

    const changed = await auth.changePassword(
      login.user.id,
      'a-long-password',
      'another-long-password'
    )
    expect(auth.session(login.token)).toBeUndefined()
    expect(auth.session(changed.token)).toBeTruthy()
    await expect(auth.login('admin', 'a-long-password', '127.0.0.1')).rejects.toBeInstanceOf(
      PanelAuthError
    )
  })

  it('keeps a remembered session past the default idle window', async () => {
    let now = 1_000_000
    const clock = new PanelAuth({ users, configDir: dir, now: () => now })
    await clock.setup(undefined, 'admin', 'a-long-password')

    const tab = await clock.login('admin', 'a-long-password', '127.0.0.1', false)
    const remembered = await clock.login('admin', 'a-long-password', '127.0.0.1', true)
    expect(tab.remember).toBe(false)
    expect(remembered.remember).toBe(true)
    expect(clock.isRemembered(tab.token)).toBe(false)
    expect(clock.isRemembered(remembered.token)).toBe(true)

    now += 31 * 60_000
    expect(clock.session(tab.token)).toBeUndefined()
    expect(clock.session(remembered.token)).toMatchObject({ username: 'admin' })
  })

  it('expires a remembered session at its absolute limit', async () => {
    let now = 1_000_000
    const clock = new PanelAuth({
      users,
      configDir: dir,
      now: () => now,
      rememberIdleMs: 10_000,
      rememberAbsoluteMs: 10_000,
    })
    await clock.setup(undefined, 'admin', 'a-long-password')
    const remembered = await clock.login('admin', 'a-long-password', '127.0.0.1', true)

    now += 11_000
    expect(clock.session(remembered.token)).toBeUndefined()
  })

  it('keeps a remembered session across an agent restart', async () => {
    const sessions = new SqlitePanelSessionStore(db)
    const before = new PanelAuth({ users, configDir: dir, sessions })
    await before.setup(undefined, 'admin', 'a-long-password')
    const login = await before.login('admin', 'a-long-password', '127.0.0.1', true)

    const restarted = new PanelAuth({
      users,
      configDir: dir,
      sessions: new SqlitePanelSessionStore(db),
    })
    expect(restarted.session(login.token)).toMatchObject({ username: 'admin' })
    restarted.logout(login.token)
    expect(restarted.session(login.token)).toBeUndefined()
  })

  it('revokes a persisted session with a host reset', async () => {
    const sessions = new SqlitePanelSessionStore(db)
    const before = new PanelAuth({ users, configDir: dir, sessions })
    const login = await before.setup(undefined, 'admin', 'a-long-password')
    expect(before.session(login.token)).toBeTruthy()

    before.resetForHost()

    const restarted = new PanelAuth({
      users,
      configDir: dir,
      sessions: new SqlitePanelSessionStore(db),
    })
    expect(restarted.session(login.token)).toBeUndefined()
  })

  it('keeps a remembered session remembered after a password change', async () => {
    const login = await auth.setup(undefined, 'admin', 'a-long-password')
    const remembered = await auth.login('admin', 'a-long-password', '127.0.0.1', true)
    expect(remembered.remember).toBe(true)

    const changed = await auth.changePassword(
      remembered.user.id,
      'a-long-password',
      'another-long-password',
      auth.isRemembered(remembered.token)
    )
    expect(login.token).toBeTruthy()
    expect(changed.remember).toBe(true)
    expect(auth.isRemembered(changed.token)).toBe(true)
  })
})
