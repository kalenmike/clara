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
