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

/**
 * A host-level lock on one feature switch. The bundled panel uses it for the
 * transport that carries its own connection, which it must not be able to cut.
 */
export type FeatureControlLock = {
  locked: boolean
  /** Why the switch is unavailable, shown as its tooltip and in the card. */
  reason: string
}

/** Save one feature choice and expose the in-flight and failure state. */
export function useFeatureControl(
  feature: PanelFeatureControl,
  stopped: boolean,
  onChanged: () => void,
  lock?: FeatureControlLock
) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const locked = lock?.locked === true
  const lockReason = locked ? lock?.reason : undefined

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
    locked,
    lockReason,
    disabled: pending || stopped || locked,
    title: locked ? lockReason : stopped ? 'Go online before changing features' : undefined,
    toggle,
  }
}
