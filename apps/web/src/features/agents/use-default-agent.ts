import { useCallback, useSyncExternalStore } from 'react'
import {
  readDefaultAgent,
  readLastAgent,
  saveDefaultAgent,
  subscribeAgentDefault,
  type DefaultAgentSettings,
} from './default-agent'

export function useDefaultAgent() {
  const settings = useSyncExternalStore(subscribeAgentDefault, readDefaultAgent, readDefaultAgent)
  const lastAgent = useSyncExternalStore(subscribeAgentDefault, readLastAgent, readLastAgent)

  const update = useCallback((patch: Partial<DefaultAgentSettings>) => {
    saveDefaultAgent({ ...readDefaultAgent(), ...patch })
  }, [])

  return { settings, lastAgent, update }
}
