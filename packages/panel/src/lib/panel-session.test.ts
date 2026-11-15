import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPanelSessionToken,
  getPanelSessionToken,
  PANEL_SESSION_STORAGE_KEY,
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
  it('stores one token under a single session key', () => {
    const storage = memoryStorage()

    setPanelSessionToken('first', storage)

    expect(PANEL_SESSION_STORAGE_KEY).toBe('clara.panel.session')
    expect(storage.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('first')
    expect(getPanelSessionToken(storage)).toBe('first')
    expect(storage.values.size).toBe(1)
  })

  it('replaces the token and clears it', () => {
    const storage = memoryStorage()

    setPanelSessionToken('first', storage)
    setPanelSessionToken('second', storage)
    expect(getPanelSessionToken(storage)).toBe('second')

    clearPanelSessionToken(storage)
    expect(getPanelSessionToken(storage)).toBeNull()
  })

  it('clears the token when given a blank value', () => {
    const storage = memoryStorage({ [PANEL_SESSION_STORAGE_KEY]: 'stale' })

    setPanelSessionToken('   ', storage)

    expect(getPanelSessionToken(storage)).toBeNull()
  })

  it('survives a missing or blocked storage', () => {
    expect(getPanelSessionToken(undefined)).toBeNull()
    expect(() => setPanelSessionToken('token', undefined)).not.toThrow()
    expect(() => clearPanelSessionToken(undefined)).not.toThrow()

    const blocked = blockedStorage()
    expect(getPanelSessionToken(blocked)).toBeNull()
    expect(() => setPanelSessionToken('token', blocked)).not.toThrow()
    expect(() => clearPanelSessionToken(blocked)).not.toThrow()
  })

  it('defaults to sessionStorage and never touches localStorage', () => {
    const session = memoryStorage()
    const local = memoryStorage()
    vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('localStorage', local)

    setPanelSessionToken('tab-token')

    expect(session.values.get(PANEL_SESSION_STORAGE_KEY)).toBe('tab-token')
    expect(getPanelSessionToken()).toBe('tab-token')
    expect(local.values.size).toBe(0)

    clearPanelSessionToken()
    expect(getPanelSessionToken()).toBeNull()
  })
})

describe('panel session token lifecycle', () => {
  it('keeps the token a sign-in response carries and ignores one that omits it', () => {
    const storage = memoryStorage()

    expect(rememberSessionToken({ sessionToken: 'login-token' }, storage)).toBe('login-token')
    expect(getPanelSessionToken(storage)).toBe('login-token')

    // A panel served by the hub service answers without a token; its cookie
    // keeps working and the stored value is untouched.
    expect(rememberSessionToken({}, storage)).toBeNull()
    expect(getPanelSessionToken(storage)).toBe('login-token')
  })

  it('replaces the token on setup and password changes, then drops it on sign-out', () => {
    const storage = memoryStorage()

    rememberSessionToken({ sessionToken: 'setup-token' }, storage)
    rememberSessionToken({ sessionToken: 'changed-token' }, storage)
    expect(getPanelSessionToken(storage)).toBe('changed-token')

    clearPanelSessionToken(storage)
    expect(getPanelSessionToken(storage)).toBeNull()

    // invalidate() clears as well, so a rejected session leaves no token.
    rememberSessionToken({ sessionToken: 'expired-token' }, storage)
    clearPanelSessionToken(storage)
    expect(getPanelSessionToken(storage)).toBeNull()
  })
})
