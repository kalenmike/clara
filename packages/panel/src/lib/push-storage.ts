import { useState } from 'react'
import type { PanelPushStorageMutationResponse } from '@clara/shared-types'
import { postPanel } from './panel-api.ts'

export type PushStorageAction = 'reload' | 'reset'

/**
 * Retry or reset the hub's subscriptions file. Both actions refresh the panel
 * snapshot, so the card reflects the recovered or cleared store immediately.
 */
export function usePushStorageControl(onChanged: () => void) {
  const [pending, setPending] = useState<PushStorageAction | null>(null)
  const [error, setError] = useState<string>()

  const run = (action: PushStorageAction) => {
    setPending(action)
    setError(undefined)
    void postPanel<PanelPushStorageMutationResponse>('/panel/api/v1/push', { action })
      .then(onChanged)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => setPending(null))
  }

  return {
    pending,
    error,
    reload: () => run('reload'),
    reset: () => run('reset'),
  }
}
