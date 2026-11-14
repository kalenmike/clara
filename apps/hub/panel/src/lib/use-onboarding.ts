import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PanelSnapshot } from '@clara/shared-types'
import {
  buildSetupState,
  readSetupPreferences,
  writeSetupPreferences,
  type SetupPath,
  type SetupPreferences,
  type SetupState,
} from './onboarding.ts'

export type SetupModalMode = 'setup' | 'reconfigure' | 'guide'

type OnboardingController = {
  open: boolean
  mode: SetupModalMode
  setup: SetupState
  preferences: SetupPreferences
  openSetup: () => void
  openReconfigure: () => void
  openGuide: () => void
  close: () => void
  finish: () => void
  setPath: (path: SetupPath) => void
}

function storage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function now(): string {
  return new Date().toISOString()
}

export function useOnboarding(snapshot: PanelSnapshot | undefined): OnboardingController {
  const [preferences, setPreferences] = useState<SetupPreferences>(() =>
    readSetupPreferences(storage())
  )
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<SetupModalMode>('setup')

  const update = useCallback((patch: SetupPreferences) => {
    setPreferences((previous) => {
      const next = { ...previous, ...patch }
      writeSetupPreferences(storage(), next)
      return next
    })
  }, [])

  const setup = useMemo(
    () => buildSetupState(snapshot, preferences.path),
    [snapshot, preferences.path]
  )

  useEffect(() => {
    if (!snapshot) return
    if (setup.requiredDone) {
      if (!preferences.completedAt) update({ completedAt: now() })
      return
    }
    if (open || preferences.dismissedAt || preferences.completedAt) return
    setMode('setup')
    setOpen(true)
  }, [snapshot, setup.requiredDone, open, preferences.completedAt, preferences.dismissedAt, update])

  const openSetup = useCallback(() => {
    setMode('setup')
    setOpen(true)
  }, [])

  const openReconfigure = useCallback(() => {
    setMode('reconfigure')
    setOpen(true)
  }, [])

  const openGuide = useCallback(() => {
    setMode('guide')
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    update({ dismissedAt: now() })
    setOpen(false)
  }, [update])

  const finish = useCallback(() => {
    const stamp = now()
    update({ completedAt: preferences.completedAt ?? stamp, guideSeenAt: stamp })
    setOpen(false)
  }, [preferences.completedAt, update])

  const setPath = useCallback(
    (path: SetupPath) => {
      update({ path })
    },
    [update]
  )

  return {
    open,
    mode,
    setup,
    preferences,
    openSetup,
    openReconfigure,
    openGuide,
    close,
    finish,
    setPath,
  }
}
