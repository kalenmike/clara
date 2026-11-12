import { useCallback, useSyncExternalStore } from 'react'
import {
  readShowArchivedProjects,
  saveShowArchivedProjects,
  subscribeShowArchivedProjects,
} from '@/features/projects/show-archived-projects'

export function useShowArchivedProjects() {
  const showArchived = useSyncExternalStore(
    subscribeShowArchivedProjects,
    readShowArchivedProjects,
    readShowArchivedProjects
  )

  const setShowArchived = useCallback((next: boolean) => {
    saveShowArchivedProjects(next)
  }, [])

  return { showArchived, setShowArchived }
}
