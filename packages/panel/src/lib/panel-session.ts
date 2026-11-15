/**
 * The hub panel session token, kept in `sessionStorage` for the tab.
 *
 * A panel served by the hub service authenticates with its same-origin cookie
 * and never receives a token. A panel reached through the hub bridge gets a
 * token from sign-in and carries it as a bearer credential; the token is
 * session-scoped, so a new tab signs in again.
 */
export const PANEL_SESSION_STORAGE_KEY = 'clara.panel.session'

export type PanelSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A login, setup, or password response; only a tunneled panel includes a token. */
export type PanelSessionResponse = {
  sessionToken?: string
}

export function getPanelSessionToken(
  storage: PanelSessionStorage | undefined = defaultPanelSessionStorage()
): string | null {
  try {
    const token = storage?.getItem(PANEL_SESSION_STORAGE_KEY)
    return token ? token : null
  } catch {
    return null
  }
}

export function setPanelSessionToken(
  token: string,
  storage: PanelSessionStorage | undefined = defaultPanelSessionStorage()
): void {
  const value = token.trim()
  if (!value) {
    clearPanelSessionToken(storage)
    return
  }
  try {
    storage?.setItem(PANEL_SESSION_STORAGE_KEY, value)
  } catch {
    // The panel still works for one request when the browser blocks storage.
  }
}

export function clearPanelSessionToken(
  storage: PanelSessionStorage | undefined = defaultPanelSessionStorage()
): void {
  try {
    storage?.removeItem(PANEL_SESSION_STORAGE_KEY)
  } catch {
    // The panel still works when the browser blocks storage.
  }
}

/**
 * Store the token a sign-in response carries. A panel served by the hub
 * service omits it, so the existing value is left alone and its behavior is
 * unchanged.
 */
export function rememberSessionToken(
  response: PanelSessionResponse,
  storage: PanelSessionStorage | undefined = defaultPanelSessionStorage()
): string | null {
  const token = response.sessionToken
  if (typeof token !== 'string' || !token.trim()) return null
  setPanelSessionToken(token, storage)
  return token
}

function defaultPanelSessionStorage(): PanelSessionStorage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}
