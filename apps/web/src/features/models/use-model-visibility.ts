import { useCallback, useSyncExternalStore } from 'react'
import {
  isModelHidden,
  isProviderHidden,
  readHiddenModels,
  saveHiddenModels,
  subscribeHiddenModels,
  unhideAllModels,
  withModelHidden,
  withProviderHidden,
} from '@/features/models/visibility'

export function useModelVisibility() {
  const visibility = useSyncExternalStore(
    subscribeHiddenModels,
    readHiddenModels,
    readHiddenModels
  )

  const setProviderHidden = useCallback((providerID: string, hidden: boolean) => {
    saveHiddenModels(withProviderHidden(readHiddenModels(), providerID, hidden))
  }, [])

  const setModelHidden = useCallback(
    (providerID: string, modelID: string, hidden: boolean) => {
      saveHiddenModels(withModelHidden(readHiddenModels(), providerID, modelID, hidden))
    },
    []
  )

  const unhideAll = useCallback(() => {
    saveHiddenModels(unhideAllModels())
  }, [])

  const providerHidden = useCallback(
    (providerID: string) => isProviderHidden(visibility, providerID),
    [visibility]
  )

  const modelHidden = useCallback(
    (providerID: string, modelID: string) => isModelHidden(visibility, providerID, modelID),
    [visibility]
  )

  return {
    visibility,
    hiddenCount: visibility.providers.length + visibility.models.length,
    isProviderHidden: providerHidden,
    isModelHidden: modelHidden,
    setProviderHidden,
    setModelHidden,
    unhideAll,
  }
}
