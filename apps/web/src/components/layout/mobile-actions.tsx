/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type MobileActionsContextValue = {
  node: HTMLDivElement | null
  setNode: (node: HTMLDivElement | null) => void
}

const MobileActionsContext = createContext<MobileActionsContextValue | null>(null)

/**
 * Shares the mobile app-bar mount point between the shell and the page header.
 * The slot is always in the DOM; the bar itself is only visible below `md`.
 */
export function MobileActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  return (
    <MobileActionsContext.Provider value={{ node, setNode }}>
      {children}
    </MobileActionsContext.Provider>
  )
}

export function MobileActionsSlot({ className }: { className?: string }) {
  const { setNode } = useMobileActions()
  return <div ref={setNode} className={cn('ml-auto flex items-center gap-1', className)} />
}

export function useMobileActions() {
  const value = useContext(MobileActionsContext)
  if (!value) throw new Error('useMobileActions must be used inside MobileActionsProvider')
  return value
}
