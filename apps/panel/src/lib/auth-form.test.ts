import { describe, expect, it } from 'vitest'
import type { PanelAuthStatus } from '@clara/shared-types'
import { authFormMode, canResetWithToken } from './auth-form.ts'

const signedOut = (setupRequired: boolean, resetPending: boolean): PanelAuthStatus => ({
  authenticated: false,
  setupRequired,
  resetPending,
})

describe('auth form mode', () => {
  it('shows the setup form on first run and never offers a reset link', () => {
    const status = signedOut(true, false)
    expect(authFormMode(status, false)).toBe('setup')
    expect(authFormMode(status, true)).toBe('setup')
    expect(canResetWithToken(status)).toBe(false)
  })

  it('keeps sign-in visible until the reset link is opened', () => {
    const status = signedOut(false, true)
    expect(authFormMode(status, false)).toBe('login')
    expect(canResetWithToken(status)).toBe(true)
    expect(authFormMode(status, true)).toBe('reset')
  })

  it('hides the reset link when no token is pending', () => {
    const status = signedOut(false, false)
    expect(authFormMode(status, true)).toBe('login')
    expect(canResetWithToken(status)).toBe(false)
  })

  it('treats a missing or authenticated status as sign-in', () => {
    expect(authFormMode(undefined, true)).toBe('login')
    expect(canResetWithToken(undefined)).toBe(false)
    const authenticated: PanelAuthStatus = {
      authenticated: true,
      user: { username: 'admin', role: 'superadmin' },
    }
    expect(authFormMode(authenticated, true)).toBe('login')
    expect(canResetWithToken(authenticated)).toBe(false)
  })
})
