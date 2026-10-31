import { useCallback, useSyncExternalStore } from 'react'
import {
  readSessionWording,
  resetSessionWording,
  saveSessionWording,
  subscribeSessionWording,
  type SessionWording,
} from './wording'

export function useSessionWording() {
  const wording: SessionWording = useSyncExternalStore(
    subscribeSessionWording,
    readSessionWording,
    readSessionWording
  )

  const setSingular = useCallback((value: string) => saveSessionWording(value), [])
  const reset = useCallback(() => resetSessionWording(), [])

  return { ...wording, setSingular, reset }
}
