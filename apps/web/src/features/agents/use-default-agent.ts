import { useCallback, useSyncExternalStore } from 'react'
import {
  readDefaultAgent,
  readLastAgent,
  saveDefaultAgent,
  subscribeAgentDefault,
  type DefaultAgentSettings,
} from './default-agent'

export function useDefaultAgent(harnessID: string | undefined) {
  const getSettings = useCallback(() => readDefaultAgent(harnessID), [harnessID])
  const getLastAgent = useCallback(() => readLastAgent(harnessID), [harnessID])
  const settings = useSyncExternalStore(subscribeAgentDefault, getSettings, getSettings)
  const lastAgent = useSyncExternalStore(subscribeAgentDefault, getLastAgent, getLastAgent)

  const update = useCallback(
    (patch: Partial<DefaultAgentSettings>) => {
      saveDefaultAgent(harnessID, { ...readDefaultAgent(harnessID), ...patch })
    },
    [harnessID]
  )

  return { settings, lastAgent, update }
}
