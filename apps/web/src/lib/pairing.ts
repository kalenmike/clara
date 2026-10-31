import { parsePairingInput, type PairingPayload } from '@clara/shared-types'

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
