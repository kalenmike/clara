import { useConnection } from '@/providers/connection-provider'
import { harnessLabel } from './harness-label'

/** Display name for the active harness, for React copy that names it. */
export function useHarnessLabel(fallback?: string): string {
  const { hub } = useConnection()
  return harnessLabel(hub, fallback)
}
