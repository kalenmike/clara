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
  const pairing = parsePairingInput(value)
  if (pairing) return pairingGrantError(pairing)
  const harness = parseHarnessPairingInput(value)
  if (harness || value.startsWith(HARNESS_PAIRING_CODE_PREFIX)) {
    const kind = harness && /^[a-z0-9_-]+$/i.test(harness.kind) ? harness.kind : null
    const install = kind
      ? `Run pnpm clara adapter install --${kind} --pair <code> on the machine that runs your harness.`
      : 'Install it from the hub panel on the machine that runs your harness.'
    return `That is a harness adapter pairing code. ${install} To pair this browser, use a code from pnpm clara pair.`
  }
  return 'That does not look like a Clara pairing code or link. Browser pairing codes start with clara1_.'
}

/**
 * A relay code signs the enrollment with a one-time grant that the relay checks
 * before the WebSocket upgrade. A code without one can never enroll, so reject
 * it before opening a socket. Local codes still use the enrollment token alone.
 */
export function pairingGrantError(pairing: PairingPayload): string {
  if (pairing.room === 'local') return ''
  if (pairing.wsUrl.startsWith('ws://') || pairing.wsUrl.startsWith('wss://')) {
    if (!pairing.grant?.trim()) {
      return 'This relay pairing code has no enrollment grant. Generate a new pairing code on the hub and pair again.'
    }
  }
  return ''
}

let pending: PairingPayload | null = null
let captured = false

/**
 * React Router rewrites the URL to `/connect` before provider effects run, so
 * the pairing fragment must be read at module load. The payload stays in
 * memory; the fragment is removed from the address bar immediately.
 *
 * A URL from another source (a future `clara://` deep link, which does not own
 * the address bar) can be passed in; that URL is never rewritten.
 */
export function capturePairingLink(href?: string): void {
  if (captured) return
  captured = true
  const fromLocation = href === undefined
  pending = parsePairingInput(href ?? window.location.href)
  if (!pending) return
  if (fromLocation) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  }
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
