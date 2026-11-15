/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ClaraLocationInput } from '@clara/api-client'

type HarnessScopeValue = {
  /** The harness this subtree belongs to. Undefined means no harness is known. */
  harnessID: string | undefined
}

const HarnessScopeContext = createContext<HarnessScopeValue>({ harnessID: undefined })

/**
 * Pin catalog and data hooks in a subtree to the harness that owns the current
 * session or workspace. Hooks stay disabled when there is no known harness.
 */
export function HarnessScopeProvider({
  harnessID,
  children,
}: {
  harnessID: string | undefined
  children: ReactNode
}) {
  const value = useMemo<HarnessScopeValue>(() => ({ harnessID }), [harnessID])
  return <HarnessScopeContext.Provider value={value}>{children}</HarnessScopeContext.Provider>
}

export function useHarnessScope(): string | undefined {
  return useContext(HarnessScopeContext).harnessID
}

/** An explicit harness wins; otherwise the surrounding scope. */
export function resolveHarnessID(
  harnessID: string | undefined,
  scope: string | undefined
): string | undefined {
  return harnessID ?? scope
}

/** Request input scoped to a directory and, when known, one paired harness. */
export function harnessLocation(
  directory: string | undefined,
  harnessID: string | undefined
): ClaraLocationInput {
  return {
    location: { directory },
    ...(harnessID ? { harnessID } : {}),
  }
}
