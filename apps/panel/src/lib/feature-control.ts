import { useState } from 'react'
import type { PanelControls, PanelFeatureControl, PanelFeatureName } from '@clara/shared-types'
import { postPanel } from './panel-api.ts'

export function findFeature(controls: PanelControls, name: PanelFeatureName): PanelFeatureControl {
  return (
    controls.features.find((feature) => feature.name === name) ?? {
      name,
      configured: false,
      desired: false,
      effective: false,
    }
  )
}

/** Save one feature choice and expose the in-flight and failure state. */
export function useFeatureControl(
  feature: PanelFeatureControl,
  stopped: boolean,
  onChanged: () => void
) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const toggle = () => {
    setPending(true)
    setError(undefined)
    void postPanel('/panel/api/v1/features', { feature: feature.name, enabled: !feature.desired })
      .then(onChanged)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => setPending(false))
  }

  return {
    pending,
    error,
    disabled: pending || stopped,
    title: stopped ? 'Start the agent before changing features' : undefined,
    toggle,
  }
}
