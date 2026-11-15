/**
 * The hub panel session token, kept on this device until sign-out.
 *
 * A panel served by the hub service authenticates with its same-origin cookie
 * and never receives a token. A panel reached through the hub bridge gets a
 * token from sign-in and carries it as a bearer credential. A remembered
 * token lives in `localStorage` so it survives app and browser restarts; the
 * default keeps it in `sessionStorage` for the tab only. The token is opaque
 * and revocable, and the password is never stored.
 */
export const PANEL_SESSION_STORAGE_KEY = 'clara.panel.session'
/** The sign-in name is not a secret, so it is recalled even without a session. */
export const PANEL_USERNAME_STORAGE_KEY = 'clara.panel.username'

export type PanelSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A login, setup, or password response; only a tunneled panel includes a token. */
export type PanelSessionResponse = {
  sessionToken?: string
  /** The server kept this session across restarts; store it for the device. */
  remember?: boolean
}

export type PanelSessionTarget = {
  /** Store in `localStorage` instead of `sessionStorage`. */
  remember?: boolean
  local?: PanelSessionStorage
  session?: PanelSessionStorage
}

export function getPanelSessionToken(
  local: PanelSessionStorage | undefined = defaultStorage('local'),
  session: PanelSessionStorage | undefined = defaultStorage('session')
): string | null {
  return read(local, PANEL_SESSION_STORAGE_KEY) ?? read(session, PANEL_SESSION_STORAGE_KEY)
}

export function setPanelSessionToken(token: string, target: PanelSessionTarget = {}): void {
  const value = token.trim()
  const local = target.local ?? defaultStorage('local')
  const session = target.session ?? defaultStorage('session')
  if (!value) {
    clearPanelSessionToken({ local, session })
    return
  }
  if (target.remember) {
    write(local, value)
    remove(session)
    return
  }
  write(session, value)
  remove(local)
}

export function clearPanelSessionToken(
  target: Pick<PanelSessionTarget, 'local' | 'session'> = {}
): void {
  const local = target.local ?? defaultStorage('local')
  const session = target.session ?? defaultStorage('session')
  remove(local)
  remove(session)
}

/**
 * Store the token a sign-in response carries. A panel served by the hub
 * service omits it, so the existing value is left alone and its behavior is
 * unchanged.
 */
export function rememberSessionToken(
  response: PanelSessionResponse,
  target: PanelSessionTarget = {}
): string | null {
  const token = response.sessionToken
  if (typeof token !== 'string' || !token.trim()) return null
  setPanelSessionToken(token, { ...target, remember: response.remember === true })
  return token
}

/** Recall the last sign-in name; it carries no secret. */
export function getPanelUsername(
  storage: PanelSessionStorage | undefined = defaultStorage('local')
): string | null {
  const value = read(storage, PANEL_USERNAME_STORAGE_KEY)?.trim()
  return value ? value : null
}

export function rememberPanelUsername(
  username: string,
  storage: PanelSessionStorage | undefined = defaultStorage('local')
): void {
  const value = username.trim()
  if (!value) return
  attempt(() => storage?.setItem(PANEL_USERNAME_STORAGE_KEY, value))
}

function read(storage: PanelSessionStorage | undefined, key: string): string | null {
  try {
    const value = storage?.getItem(key)
    return value ? value : null
  } catch {
    return null
  }
}

function write(storage: PanelSessionStorage | undefined, value: string): void {
  attempt(() => storage?.setItem(PANEL_SESSION_STORAGE_KEY, value))
}

function remove(storage: PanelSessionStorage | undefined): void {
  attempt(() => storage?.removeItem(PANEL_SESSION_STORAGE_KEY))
}

function attempt(run: () => void): void {
  try {
    run()
  } catch {
    // The panel still works for one request when the browser blocks storage.
  }
}

function defaultStorage(kind: 'local' | 'session'): PanelSessionStorage | undefined {
  try {
    const storage = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
    return storage ?? undefined
  } catch {
    return undefined
  }
}
