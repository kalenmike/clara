import { useCallback, useSyncExternalStore } from 'react'
import {
  readShowEmptyProjects,
  saveShowEmptyProjects,
  subscribeShowEmptyProjects,
} from '@/features/projects/show-empty-projects'

export function useShowEmptyProjects() {
  const showEmpty = useSyncExternalStore(
    subscribeShowEmptyProjects,
    readShowEmptyProjects,
    readShowEmptyProjects
  )

  const setShowEmpty = useCallback((next: boolean) => {
    saveShowEmptyProjects(next)
  }, [])

  return { showEmpty, setShowEmpty }
}
