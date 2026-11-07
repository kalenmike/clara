import { useCallback, useSyncExternalStore } from 'react'
import {
  readCostDisplay,
  saveCostDisplay,
  subscribeCostDisplay,
  type CostDisplaySource,
} from '@/features/cost/cost-display'

export function useCostDisplay() {
  const source = useSyncExternalStore(subscribeCostDisplay, readCostDisplay, readCostDisplay)

  const setSource = useCallback((next: CostDisplaySource) => {
    saveCostDisplay(next)
  }, [])

  return { source, setSource }
}
