import type { GitCommit } from '@clara/api-contract'
import { forwardResult, forwardResultTo, type ForwardRequest } from './harness.ts'
import type { ApiDependencies } from './context.ts'
import { resolveHarnessForDirectory } from './harness-scope.ts'

export type GitLogInput = {
  directory: string
  harnessID?: string
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
  const request: ForwardRequest = {
    method: 'GET',
    path: '/git/log',
    search: `?${search.toString()}`,
  }
  const harnessID = resolveHarnessForDirectory(deps, input.directory, input.harnessID)
  return harnessID
    ? forwardResultTo<GitCommit[]>(deps, harnessID, request, signal)
    : forwardResult<GitCommit[]>(deps, request, signal)
}
