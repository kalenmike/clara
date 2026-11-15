import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPanelSessionToken,
  getPanelSessionToken,
  getPanelUsername,
  PANEL_SESSION_STORAGE_KEY,
  PANEL_USERNAME_STORAGE_KEY,
  rememberPanelUsername,
  rememberSessionToken,
  setPanelSessionToken,
  type PanelSessionStorage,
} from './panel-session.ts'

type MemoryStorage = PanelSessionStorage & { values: Map<string, string> }

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

function blockedStorage(): PanelSessionStorage {
  const fail = (): never => {
    throw new Error('storage is blocked')
  }
  return { getItem: fail, setItem: fail, removeItem: fail }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('panel session token store', () => {
  it('stores one token under a single session key by default', () => {
    const local = memoryStorage()
    const session = memoryStorage()

    setPanelSessionToken('first', { local, session })

    expect(PANEL_SESSION_STORAGE_KEY).toBe('clara.panel.session')
    expect(session.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('first')
    expect(local.values.size).toBe(0)
    expect(getPanelSessionToken(local, session)).toBe('first')
  })

  it('keeps a remembered token in localStorage and drops the tab copy', () => {
    const local = memoryStorage()
    const session = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'stale' })

    setPanelSessionToken('remembered', { remember: true, local, session })

    expect(local.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('remembered')
    expect(session.values.size).toBe(0)
    expect(getPanelSessionToken(local, session)).toBe('remembered')
  })

  it('switches back to sessionStorage when remember is off', () => {
    const local = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'stale' })
    const session = memoryStorage()

    setPanelSessionToken('tab-only', { local, session })

    expect(session.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('tab-only')
    expect(local.values.size).toBe(0)
  })

  it('prefers the remembered token when both stores hold one', () => {
    const local = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'remembered' })
    const session = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'tab' })

    expect(getPanelSessionToken(local, session)).toBe('remembered')
  })

  it('clears the token from both stores', () => {
    const local = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'remembered' })
    const session = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'tab' })

    clearPanelSessionToken({ local, session })

    expect(getPanelSessionToken(local, session)).toBeNull()
    expect(local.values.size).toBe(0)
    expect(session.values.size).toBe(0)
  })

  it('clears the token when given a blank value', () => {
    const local = memoryStorage()
    const session = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'stale' })

    setPanelSessionToken('   ', { local, session })

    expect(getPanelSessionToken(local, session)).toBeNull()
  })

  it('survives a missing or blocked storage', () => {
    const blocked = blockedStorage()

    expect(getPanelSessionToken(undefined, undefined)).toBeNull()
    expect(getPanelSessionToken(blocked, blocked)).toBeNull()
    expect(() => setPanelSessionToken('token', { local: blocked, session: blocked })).not.toThrow()
    expect(() => clearPanelSessionToken({ local: blocked, session: blocked })).not.toThrow()
  })

  it('defaults to the browser stores and keeps remember in localStorage', () => {
    const session = memoryStorage()
    const local = memoryStorage()
    vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('localStorage', local)

    setPanelSessionToken('tab-token')
    expect(session.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('tab-token')
    expect(local.values.size).toBe(0)

    setPanelSessionToken('device-token', { remember: true })
    expect(local.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('device-token')
    expect(session.values.size).toBe(0)
    expect(getPanelSessionToken()).toBe('device-token')

    clearPanelSessionToken()
    expect(getPanelSessionToken()).toBeNull()
  })
})

describe('panel session token lifecycle', () => {
  it('stores a remembered sign-in response for the device', () => {
    const local = memoryStorage()
    const session = memoryStorage()

    expect(
      rememberSessionToken({ sessionToken: 'login-token', remember: true }, { local, session })
    ).toBe('login-token')
    expect(local.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('login-token')
    expect(session.values.size).toBe(0)
  })

  it('keeps a non-remembered sign-in for the tab only', () => {
    const local = memoryStorage()
    const session = memoryStorage()

    rememberSessionToken({ sessionToken: 'tab-token' }, { local, session })

    expect(session.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('tab-token')
    expect(local.values.size).toBe(0)
  })

  it('ignores a response without a token, as a served panel sends', () => {
    const local = memoryStorage()
    const session = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'login-token' })

    // A panel served by the hub service answers without a token; its cookie
    // keeps working and the stored value is untouched.
    expect(rememberSessionToken({}, { local, session })).toBeNull()
    expect(getPanelSessionToken(local, session)).toBe('login-token')
  })

  it('replaces the token on setup and password changes, then drops it on sign-out', () => {
    const local = memoryStorage()
    const session = memoryStorage()

    rememberSessionToken({ sessionToken: 'setup-token', remember: true }, { local, session })
    rememberSessionToken({ sessionToken: 'changed-token', remember: true }, { local, session })
    expect(getPanelSessionToken(local, session)).toBe('changed-token')

    clearPanelSessionToken({ local, session })
    expect(getPanelSessionToken(local, session)).toBeNull()

    // invalidate() clears as well, so a rejected session leaves no token.
    rememberSessionToken({ sessionToken: 'expired-token' }, { local, session })
    clearPanelSessionToken({ local, session })
    expect(getPanelSessionToken(local, session)).toBeNull()
  })
})

describe('panel username recall', () => {
  it('remembers the sign-in name without treating it as a secret', () => {
    const local = memoryStorage()

    rememberPanelUsername('  admin  ', local)

    expect(local.values.get(PANEL_USERNAME_STORAGE_KEY)).toBe('admin')
    expect(getPanelUsername(local)).toBe('admin')
  })

  it('is independent of sign-out', () => {
    const local = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'token' })
    const session = memoryStorage()

    rememberPanelUsername('admin', local)
    clearPanelSessionToken({ local, session })

    expect(getPanelUsername(local)).toBe('admin')
  })

  it('survives blocked or missing storage', () => {
    expect(getPanelUsername(undefined)).toBeNull()
    expect(() => rememberPanelUsername('admin', blockedStorage())).not.toThrow()
  })
})
