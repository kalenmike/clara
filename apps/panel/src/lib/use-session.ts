import { useCallback, useEffect, useState } from 'react'
import type { PanelAuthStatus, PanelAuthInfo } from '@clara/shared-types'
import { deletePanel, getPanel, postPanel } from './panel-api.ts'

type SessionResponse = { user: PanelAuthInfo }

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
      setState({
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const result = await postPanel<SessionResponse>('/panel/api/v1/session', {
      username,
      password,
    })
    setState({ status: { authenticated: true, user: result.user }, loading: false })
    return result.user
  }, [])

  const setup = useCallback(async (token: string, username: string, password: string) => {
    const result = await postPanel<SessionResponse>('/panel/api/v1/setup', {
      token,
      username,
      password,
    })
    setState({ status: { authenticated: true, user: result.user }, loading: false })
    return result.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await deletePanel('/panel/api/v1/session')
    } finally {
      setState({
        status: { authenticated: false, setupRequired: false, resetPending: false },
        loading: false,
      })
    }
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await postPanel<SessionResponse>('/panel/api/v1/account/password', {
      currentPassword,
      newPassword,
    })
    setState({ status: { authenticated: true, user: result.user }, loading: false })
    return result.user
  }, [])

  const invalidate = useCallback(() => {
    setState({
      status: { authenticated: false, setupRequired: false, resetPending: false },
      loading: false,
    })
    // A host reset revokes the session and issues a token. Re-read the status so
    // the sign-in screen can offer the reset form without a manual reload.
    void refresh()
  }, [refresh])

  return { ...state, refresh, login, setup, logout, changePassword, invalidate }
}

export type SessionController = ReturnType<typeof useSession>
