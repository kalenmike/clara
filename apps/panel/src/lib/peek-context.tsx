/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { maskText, readPeekPreference, writePeekPreference } from './peek.ts'

type PeekContextValue = {
  /** True while sensitive values are masked. */
  masked: boolean
  toggle: () => void
  /** Mask sensitive values in free text, such as activity or an error. */
  redact: (text: string) => string
}

const PeekContext = createContext<PeekContextValue | null>(null)

export function PeekProvider({
  secrets,
  children,
}: {
  /** Values `redact` must remove in addition to WebSocket URLs. */
  secrets: readonly string[]
  children: ReactNode
}) {
  const [masked, setMasked] = useState(() => readPeekPreference(getSessionStorage()) === 'masked')

  useEffect(() => {
    writePeekPreference(getSessionStorage(), masked ? 'masked' : 'shown')
  }, [masked])

  const toggle = useCallback(() => setMasked((current) => !current), [])

  const redact = useCallback(
    (text: string) => (masked ? maskText(text, secrets) : text),
    [masked, secrets]
  )

  const value = useMemo(() => ({ masked, toggle, redact }), [masked, toggle, redact])

  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>
}

export function usePeek(): PeekContextValue {
  const value = useContext(PeekContext)
  if (!value) throw new Error('usePeek must be used inside PeekProvider')
  return value
}

/** The browser can refuse storage access; the panel defaults to masked then. */
function getSessionStorage(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}
