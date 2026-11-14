import { useSyncExternalStore } from 'react'
import { useConnection } from '@/providers/connection-provider'
import {
  orchestratorModeActive,
  readOrchestratorMode,
  subscribeOrchestratorMode,
} from './client-mode'

/**
 * Resolves whether this client is using the orchestrator feature right now.
 * The hub enables the feature; this device still has to choose it.
 */
export function useOrchestratorMode() {
  const { relayStatus } = useConnection()
  const optedIn = useSyncExternalStore(
    subscribeOrchestratorMode,
    readOrchestratorMode,
    readOrchestratorMode
  )
  const serverEnabled = relayStatus?.agent?.orchestration === true

  return {
    serverEnabled,
    optedIn,
    active: orchestratorModeActive(serverEnabled, optedIn),
  }
}
