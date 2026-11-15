/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { cn } from '@clara/ui/lib/utils'

type MobileActionsContextValue = {
  node: HTMLDivElement | null
  setNode: (node: HTMLDivElement | null) => void
}

const MobileActionsContext = createContext<MobileActionsContextValue | null>(null)

/**
 * Shares the session header's mobile action mount point with the chat page.
 * The row sits below the usage bar, and the strip itself is only visible below
 * `md`; the desktop header keeps its inline controls.
 */
export function MobileActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  return (
    <MobileActionsContext.Provider value={{ node, setNode }}>
      {children}
    </MobileActionsContext.Provider>
  )
}

export function MobileActionsRow({ className }: { className?: string }) {
  const { setNode } = useMobileActions()
  return (
    <div
      ref={setNode}
      className={cn(
        'flex h-12 shrink-0 items-center justify-end gap-1 border-b bg-background px-2 md:hidden',
        className
      )}
    />
  )
}

export function useMobileActions() {
  const value = useContext(MobileActionsContext)
  if (!value) throw new Error('useMobileActions must be used inside MobileActionsProvider')
  return value
}
