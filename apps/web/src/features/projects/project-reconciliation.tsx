import { useProjectReconciliation } from './use-project-reconciliation'

/** Runs reconciliation on connect without rendering anything. */
export function ProjectReconciliation() {
  useProjectReconciliation()
  return null
}
