import { useCallback, useEffect, useState } from 'react'
import type { PanelAuthStatus, PanelAuthInfo } from '@clara/shared-types'
import { deletePanel, getPanel, PanelApiError, postPanel } from './panel-api.ts'
import {
  clearPanelSessionToken,
  rememberSessionToken,
  type PanelSessionResponse,
} from './panel-session.ts'

type SessionResponse = PanelSessionResponse & { user: PanelAuthInfo }

/** The status a signed-out panel shows; a host reset re-reads it for the token. */
const SIGNED_OUT_STATUS: PanelAuthStatus = {
  authenticated: false,
  setupRequired: false,
  setupTokenRequired: false,
  resetPending: false,
}

export type SessionState = {
  status?: PanelAuthStatus
  loading: boolean
  error?: string
}

export function useSession() {
  const [state, setState] = useState<SessionState>({ loading: true })

  const refresh = useCallback(async () => {
    setState((previous) => ({ ...previous, loading: true, error: undefined }))
    try {
      const status = await getPanel<PanelAuthStatus>('/panel/api/v1/session')
      setState({ status, loading: false })
    } catch (cause) {
      // A rejected session token is dead; the next sign-in issues a new one.
      if (cause instanceof PanelApiError && cause.status === 401) clearPanelSessionToken()
      setState({
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string, remember = false) => {
    const result = await postPanel<SessionResponse>('/panel/api/v1/session', {
      username,
      password,
      remember,
    })
    rememberSessionToken(result)
    setState({ status: { authenticated: true, user: result.user }, loading: false })
    return result.user
  }, [])

  const setup = useCallback(
    async (token: string, username: string, password: string, remember = true) => {
      const result = await postPanel<SessionResponse>('/panel/api/v1/setup', {
        ...(token ? { token } : {}),
        username,
        password,
        remember,
      })
      rememberSessionToken(result)
      setState({ status: { authenticated: true, user: result.user }, loading: false })
      return result.user
    },
    []
  )

  const logout = useCallback(async () => {
    try {
      await deletePanel('/panel/api/v1/session')
    } finally {
      clearPanelSessionToken()
      setState({ status: SIGNED_OUT_STATUS, loading: false })
    }
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await postPanel<SessionResponse>('/panel/api/v1/account/password', {
      currentPassword,
      newPassword,
    })
    rememberSessionToken(result)
    setState({ status: { authenticated: true, user: result.user }, loading: false })
    return result.user
  }, [])

  const invalidate = useCallback(() => {
    clearPanelSessionToken()
    setState({ status: SIGNED_OUT_STATUS, loading: false })
    // A host reset revokes the session and issues a token. Re-read the status so
    // the sign-in screen can offer the reset form without a manual reload.
    void refresh()
  }, [refresh])

  return { ...state, refresh, login, setup, logout, changePassword, invalidate }
}

export type SessionController = ReturnType<typeof useSession>
