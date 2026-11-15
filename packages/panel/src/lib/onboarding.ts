import type { PanelSnapshot } from '@clara/shared-types'

export type SetupPath = 'local' | 'relay'

export type SetupStepId = 'connection' | 'harness' | 'client' | 'ready'

export type SetupStep = {
  id: SetupStepId
  label: string
  done: boolean
  optional?: boolean
}

export type SetupProgress = {
  done: number
  total: number
}

export type SetupState = {
  path?: SetupPath
  relayReady: boolean
  webUrlReady: boolean
  connectionReady: boolean
  harnessReady: boolean
  clientReady: boolean
  requiredDone: boolean
  progress: SetupProgress
  current: SetupStepId
  steps: SetupStep[]
}

export type SetupPreferences = {
  path?: SetupPath
  dismissedAt?: string
  completedAt?: string
  guideSeenAt?: string
}

const SETUP_STORAGE_KEY = 'clara.panel.setup'

/** A remote path needs a real HTTPS origin; a local path keeps the local default. */
export function isWebUrlReady(value: string, path: SetupPath | undefined): boolean {
  if (path !== 'relay') return true
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return false
    return !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Derives the setup checklist from one live snapshot. Only the path choice is
 * stored; every completion flag comes from the hub itself so the checklist
 * cannot go stale after a delete or a reconnect.
 */
export function buildSetupState(
  snapshot: PanelSnapshot | undefined,
  path: SetupPath | undefined
): SetupState {
  const relayReady = snapshot?.relay.configured === true && snapshot.relay.status === 'online'
  const webUrlReady = isWebUrlReady(snapshot?.config.pairingBaseUrl.value ?? '', path)
  const connectionReady = path === 'local' || (path === 'relay' && relayReady && webUrlReady)
  const harnessReady = (snapshot?.harnesses.length ?? 0) > 0
  const clientReady = snapshot?.devices.some((device) => device.revokedAt === undefined) === true
  const requiredDone = connectionReady && harnessReady && clientReady
  const done = [connectionReady, harnessReady, clientReady].filter(Boolean).length

  const steps: SetupStep[] = [
    { id: 'connection', label: 'Connection path', done: connectionReady },
    { id: 'harness', label: 'Harness', done: harnessReady },
    { id: 'client', label: 'Client', done: clientReady },
    { id: 'ready', label: 'Ready', done: requiredDone },
  ]

  return {
    ...(path ? { path } : {}),
    relayReady,
    webUrlReady,
    connectionReady,
    harnessReady,
    clientReady,
    requiredDone,
    progress: { done, total: 3 },
    current: !connectionReady
      ? 'connection'
      : !harnessReady
        ? 'harness'
        : !clientReady
          ? 'client'
          : 'ready',
    steps,
  }
}

export function readSetupPreferences(storage: Storage | undefined): SetupPreferences {
  if (!storage) return {}
  try {
    const raw = storage.getItem(SETUP_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<SetupPreferences>
    return {
      ...(parsed.path === 'local' || parsed.path === 'relay' ? { path: parsed.path } : {}),
      ...(typeof parsed.dismissedAt === 'string' ? { dismissedAt: parsed.dismissedAt } : {}),
      ...(typeof parsed.completedAt === 'string' ? { completedAt: parsed.completedAt } : {}),
      ...(typeof parsed.guideSeenAt === 'string' ? { guideSeenAt: parsed.guideSeenAt } : {}),
    }
  } catch {
    return {}
  }
}

export function writeSetupPreferences(
  storage: Storage | undefined,
  preferences: SetupPreferences
): void {
  if (!storage) return
  try {
    storage.setItem(SETUP_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // A full or blocked storage must not break the panel.
  }
}
