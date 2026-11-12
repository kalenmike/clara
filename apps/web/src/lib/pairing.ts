import {
  HARNESS_PAIRING_CODE_PREFIX,
  parseHarnessPairingInput,
  parsePairingInput,
  type PairingPayload,
} from '@clara/shared-types'

/**
 * Browser codes and adapter codes look alike but enroll different things.
 * Name the adapter case so a panel code is not reported as random text.
 */
export function pairingInputError(input: string): string {
  const value = input.trim()
  if (!value) return 'Enter a Clara pairing code or link.'
  if (parsePairingInput(value)) return ''
  if (value.startsWith(HARNESS_PAIRING_CODE_PREFIX) || parseHarnessPairingInput(value)) {
    return 'That is a harness adapter pairing code. Run pnpm clara adapter install --opencode --pair <code> on the machine that runs OpenCode. To pair this browser, use a code from pnpm clara pair.'
  }
  return 'That does not look like a Clara pairing code or link. Browser pairing codes start with clara1_.'
}

let pending: PairingPayload | null = null
let captured = false

/**
 * React Router rewrites the URL to `/connect` before provider effects run, so
 * the pairing fragment must be read at module load. The payload stays in
 * memory; the fragment is removed from the address bar immediately.
 */
export function capturePairingLink(): void {
  if (captured) return
  captured = true
  pending = parsePairingInput(window.location.href)
  if (!pending) return
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
}

export function takePairingLink(): PairingPayload | null {
  const value = pending
  pending = null
  return value
}

/** Inspect a captured link without consuming it, so boot UI can label itself. */
export function hasPendingPairingLink(): boolean {
  return pending !== null
}
