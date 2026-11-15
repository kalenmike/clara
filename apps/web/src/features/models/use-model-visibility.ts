import { useCallback, useSyncExternalStore } from 'react'
import {
  disableAllModels,
  enableAllModels,
  hiddenModelsFor,
  isModelHidden,
  isProviderHidden,
  readHiddenModels,
  saveHiddenModels,
  subscribeHiddenModels,
  withModelHidden,
  withProviderHidden,
} from '@/features/models/visibility'

export function useModelVisibility(harnessID: string | undefined) {
  const state = useSyncExternalStore(subscribeHiddenModels, readHiddenModels, readHiddenModels)
  const visibility = hiddenModelsFor(state, harnessID)

  const setProviderHidden = useCallback(
    (providerID: string, hidden: boolean) => {
      if (!harnessID) return
      saveHiddenModels(withProviderHidden(readHiddenModels(), harnessID, providerID, hidden))
    },
    [harnessID]
  )

  const setModelHidden = useCallback(
    (providerID: string, modelID: string, hidden: boolean) => {
      if (!harnessID) return
      saveHiddenModels(withModelHidden(readHiddenModels(), harnessID, providerID, modelID, hidden))
    },
    [harnessID]
  )

  const enableAll = useCallback(() => {
    if (!harnessID) return
    saveHiddenModels(enableAllModels(readHiddenModels(), harnessID))
  }, [harnessID])

  const disableAll = useCallback(
    (providerIDs: string[]) => {
      if (!harnessID) return
      saveHiddenModels(disableAllModels(readHiddenModels(), harnessID, providerIDs))
    },
    [harnessID]
  )

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
    enableAll,
    disableAll,
  }
}
