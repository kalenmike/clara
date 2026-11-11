import type { GitCommit } from '@clara/api-contract'
import { forwardResult } from './harness.ts'
import type { ApiDependencies } from './context.ts'

export type GitLogInput = {
  directory: string
  since: number
  until?: number
}

export async function loadGitLog(
  deps: ApiDependencies,
  input: GitLogInput,
  signal: AbortSignal
): Promise<GitCommit[]> {
  const search = new URLSearchParams()
  search.set('directory', input.directory)
  search.set('since', String(input.since))
  if (input.until !== undefined) search.set('until', String(input.until))
  return forwardResult<GitCommit[]>(
    deps,
    { method: 'GET', path: '/git/log', search: `?${search.toString()}` },
    signal
  )
}
