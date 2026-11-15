import type { PanelAuthStatus } from '@clara/shared-types'

export type AuthFormMode = 'setup' | 'reset' | 'login'

/**
 * The first run always shows the setup form. A host-issued reset token adds an
 * opt-in reset form to the sign-in screen; without one, only sign-in remains.
 */
export function authFormMode(
  status: PanelAuthStatus | undefined,
  resetOpen: boolean
): AuthFormMode {
  if (status?.authenticated === false) {
    if (status.setupRequired) return 'setup'
    if (status.resetPending && resetOpen) return 'reset'
  }
  return 'login'
}

/** Whether the sign-in screen should offer the reset-token link. */
export function canResetWithToken(status: PanelAuthStatus | undefined): boolean {
  return status?.authenticated === false && !status.setupRequired && status.resetPending
}

/** Whether the first-run form must include the host-supplied setup token. */
export function setupNeedsToken(status: PanelAuthStatus | undefined): boolean {
  return status?.authenticated === false && status.setupRequired && status.setupTokenRequired
}

/**
 * Sign-in needs the username, first-run setup picks one, and a reset token is
 * already bound to the existing account.
 */
export function showsUsernameField(mode: AuthFormMode): boolean {
  return mode !== 'reset'
}
