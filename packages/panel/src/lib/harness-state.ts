import type { PanelHarness } from '@clara/shared-types'

export type HarnessStateTone = 'neutral' | 'success' | 'warning'

export type HarnessState = {
  key: 'disabled' | 'online' | 'paired' | 'unpaired' | 'forgotten'
  label: string
  tone: HarnessStateTone
}

type HarnessStatusInput = Pick<PanelHarness, 'online' | 'credentialConfigured' | 'forgottenAt'>

/**
 * A paired adapter is not the same as a live one, and turning the Harness
 * switch off makes the hub stop proxying even when the adapter process keeps
 * its WebSocket open. Derive one honest label for the card instead of showing
 * the persisted `online` flag on its own.
 */
export function harnessState(connection: HarnessStatusInput, enabled: boolean): HarnessState {
  if (connection.forgottenAt) return { key: 'forgotten', label: 'Forgotten', tone: 'neutral' }
  if (!enabled) return { key: 'disabled', label: 'Off', tone: 'neutral' }
  if (connection.online) return { key: 'online', label: 'Online', tone: 'success' }
  if (connection.credentialConfigured) {
    return { key: 'paired', label: 'Paired · Offline', tone: 'warning' }
  }
  return { key: 'unpaired', label: 'Not paired', tone: 'warning' }
}
