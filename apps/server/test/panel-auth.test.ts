import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelAuth, PanelAuthError } from '../src/panel/auth.ts'
import { readSetupToken } from '../src/panel/setup-token.ts'
import { closeDatabase, openDatabase, type ClaraDatabase } from '../src/store/database.ts'
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
  it('writes a one-time setup token with restrictive permissions', () => {
    const setup = auth.ensureSetupToken()
    expect(setup?.path).toBeTruthy()
    expect(readSetupToken(dir)).toBeTruthy()
    const mode = statSync(join(dir, 'admin-setup.txt')).mode & 0o777
    expect(mode).toBe(0o600)
    expect(auth.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: true,
      resetPending: false,
    })
  })

  it('requires the setup token and a strong password before creating the admin', async () => {
    auth.ensureSetupToken()
    const token = readSetupToken(dir)
    expect(token).toBeTruthy()

    await expect(auth.setup('wrong-token', 'admin', 'a-long-password')).rejects.toBeInstanceOf(
      PanelAuthError
    )
    await expect(auth.setup(token, 'admin', 'short')).rejects.toMatchObject({
      code: 'invalid_password',
    })

    const login = await auth.setup(token as string, 'admin', 'a-long-password')
    expect(login.user).toMatchObject({ username: 'admin', role: 'superadmin' })
    expect(auth.session(login.token)).toMatchObject({ username: 'admin' })
    expect(readSetupToken(dir)).toBeUndefined()
    expect(users.count()).toBe(1)
  })

  it('logs in, rejects a wrong password, and signs out', async () => {
    const setup = auth.ensureSetupToken()
    const token = readSetupToken(dir) as string
    await auth.setup(token, 'admin', 'a-long-password')
    expect(setup).toBeTruthy()

    const login = await auth.login('admin', 'a-long-password', '127.0.0.1')
    expect(auth.session(login.token)).toBeTruthy()
    auth.logout(login.token)
    expect(auth.session(login.token)).toBeUndefined()

    await expect(auth.login('admin', 'not-the-password', '127.0.0.1')).rejects.toMatchObject({
      code: 'invalid_credentials',
    })
  })

  it('rate limits repeated failures', async () => {
    const token = readSetupTokenFromAuth()
    await auth.setup(token, 'admin', 'a-long-password')

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
    const token = readSetupTokenFromAuth()
    const login = await auth.setup(token, 'admin', 'a-long-password')
    expect(auth.session(login.token)).toBeTruthy()

    const reset = auth.resetForHost()
    expect(auth.session(login.token)).toBeUndefined()
    expect(reset.token).toBeTruthy()
    expect(auth.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: false,
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
      resetPending: false,
    })
  })

  it('hides a reset once its token expires', async () => {
    const token = readSetupTokenFromAuth()
    await auth.setup(token, 'admin', 'a-long-password')
    auth.resetForHost()

    const later = new PanelAuth({
      users,
      configDir: dir,
      now: () => Date.now() + 25 * 60 * 60_000,
    })
    expect(later.status(undefined)).toEqual({
      authenticated: false,
      setupRequired: false,
      resetPending: false,
    })
  })

  it('keeps a host reset token across an agent restart', async () => {
    const token = readSetupTokenFromAuth()
    await auth.setup(token, 'admin', 'a-long-password')
    const reset = auth.resetForHost()

    const restarted = new PanelAuth({ users, configDir: dir })
    expect(restarted.ensureSetupToken()?.path).toBeTruthy()
    expect(restarted.status(undefined)).toMatchObject({ resetPending: true })
    const next = await restarted.setup(reset.token, 'admin', 'another-long-password')
    expect(restarted.session(next.token)).toBeTruthy()
  })

  it('changes the password and revokes the previous session', async () => {
    const token = readSetupTokenFromAuth()
    const login = await auth.setup(token, 'admin', 'a-long-password')

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
})

function readSetupTokenFromAuth(): string {
  auth.ensureSetupToken()
  return readSetupToken(dir) as string
}
