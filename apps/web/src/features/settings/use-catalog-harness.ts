import { useCallback, useMemo, useState } from 'react'
import { useHarnesses } from '@/features/projects/use-projects'

export const CATALOG_HARNESS_KEY = 'clara.settingsHarnessFilter'
export const ALL_HARNESSES = 'all'

export type CatalogHarnessFilter = typeof ALL_HARNESSES | string

function readFilter(): CatalogHarnessFilter {
  try {
    const value = window.localStorage.getItem(CATALOG_HARNESS_KEY)
    return value && value.trim() ? value : ALL_HARNESSES
  } catch {
    return ALL_HARNESSES
  }
}

/**
 * Settings has no workspace, so its catalogs are not tied to one harness. This
 * filter is a view choice, never a hub-wide default.
 */
export function useCatalogHarness() {
  const harnessesQuery = useHarnesses()
  const [stored, setStored] = useState<CatalogHarnessFilter>(readFilter)
  const harnesses = useMemo(() => harnessesQuery.data ?? [], [harnessesQuery.data])
  const value =
    stored === ALL_HARNESSES || harnesses.some((harness) => harness.harnessID === stored)
      ? stored
      : ALL_HARNESSES

  const setValue = useCallback((next: CatalogHarnessFilter) => {
    setStored(next)
    try {
      window.localStorage.setItem(CATALOG_HARNESS_KEY, next)
    } catch {
      // Storage can be unavailable in private browsing; keep the tab choice.
    }
  }, [])

  const selected = harnesses.find((harness) => harness.harnessID === value)
  const targets = value === ALL_HARNESSES ? harnesses : selected ? [selected] : []

  return {
    value,
    setValue,
    harnesses,
    selected,
    targets,
    pending: harnessesQuery.isPending,
    error: harnessesQuery.isError,
    refetch: harnessesQuery.refetch,
  }
}
