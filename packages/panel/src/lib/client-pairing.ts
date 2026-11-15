export type PairingTransport = 'relay' | 'local'

export type PairingTransportState = {
  allowed: PairingTransport[]
  initial?: PairingTransport
  relayUsable: boolean
  localUsable: boolean
  stopped: boolean
}

export function canStartPairing(state: PairingTransportState): boolean {
  if (state.stopped) return false
  return state.allowed.some((transport) => isUsable(transport, state))
}

export function resolvePairingTransport(state: PairingTransportState): PairingTransport {
  const allowed: PairingTransport[] = state.allowed.length > 0 ? state.allowed : ['local']
  if (state.initial && allowed.includes(state.initial) && isUsable(state.initial, state)) {
    return state.initial
  }
  const fallback = allowed.find((transport) => isUsable(transport, state))
  if (fallback) return fallback
  if (state.initial && allowed.includes(state.initial)) return state.initial
  return allowed[0] ?? 'local'
}

export function pairingNotice(state: PairingTransportState): string | undefined {
  if (canStartPairing(state)) return undefined
  if (state.stopped) {
    return 'External connections are off. Turn them on from Overview before creating a pairing code.'
  }

  const canLocal = state.allowed.includes('local')
  const canRelay = state.allowed.includes('relay')
  if (canLocal && !canRelay) {
    return 'Local transport is off, so a local pairing code cannot work. Turn it on from Network, or go back and choose the relay path.'
  }
  if (canRelay && !canLocal) {
    return 'Relay pairing is unavailable. Configure or enable the relay from Network, or go back and choose the local path.'
  }
  return 'Local and relay pairing are unavailable. Turn on a transport from Network before creating a pairing code.'
}

function isUsable(transport: PairingTransport, state: PairingTransportState): boolean {
  return transport === 'relay' ? state.relayUsable : state.localUsable
}
