import { useQuery } from '@tanstack/react-query'
import { ClientError, type VcsFileStatus, type WorktreeDirectory } from '@opencode/client'
import { type OpenCodeClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type GitRange = 'working' | 'commits' | 'branch'

export type GitCommit = {
  hash: string
  subject: string
}

export type GitWorktree = WorktreeDirectory & {
  isDefault: boolean
  isCurrent: boolean
}

/** The one command Clara runs on the host. The server policy must allow it. */
export const GIT_LOG_COMMAND = 'git log --oneline -n 10'
const COMMIT_COUNT = 10
const SHELL_TIMEOUT_MS = 10_000
const SHELL_POLL_MS = 150
const SHELL_POLL_LIMIT = Math.ceil(SHELL_TIMEOUT_MS / SHELL_POLL_MS) + 2

export function useGitInfo(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.vcsInfo(directory),
    queryFn: () => client!.vcs.get({ location: { directory } }),
    enabled: Boolean(client && directory),
    select: (result) => result.data,
    staleTime: 15_000,
  })
}

export function useGitBase(directory: string | undefined) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.vcsBase(directory),
    queryFn: () => client!.vcs.base({ location: { directory } }),
    enabled: Boolean(client && directory),
    select: (result) => result.data,
    staleTime: 15_000,
  })
}

export function useGitChanges(
  directory: string | undefined,
  range: GitRange,
  base: string | undefined
) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.vcsChanges(directory, range, base),
    queryFn: async (): Promise<VcsFileStatus[]> => {
      if (range === 'working') {
        const result = await client!.vcs.status({ location: { directory } })
        return result.data
      }

      const result = await client!.vcs.diff({
        location: { directory },
        mode: range === 'commits' ? 'committed' : 'branch',
        base,
        context: 0,
      })
      return result.data.map(({ file, additions, deletions, status }) => ({
        file,
        additions,
        deletions,
        status,
      }))
    },
    enabled: Boolean(client && directory && (range === 'working' || base)),
    staleTime: 10_000,
  })
}

/**
 * Recent commits from the session's own directory. The request travels through
 * the home agent, which applies the admin shell policy before forwarding it to
 * OpenCode. Direct connections have no agent, so the panel hides this view.
 */
export function useGitCommits(directory: string | undefined, enabled: boolean) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.gitCommits(directory),
    queryFn: ({ signal }) => {
      if (!client) throw new Error('No OpenCode client')
      if (!directory) throw new Error('No directory')
      return runGitLog(client, directory, signal)
    },
    enabled: Boolean(client && directory && enabled),
    staleTime: 15_000,
    retry: false,
  })
}

export function useGitWorktrees(
  projectID: string | undefined,
  currentDirectory: string | undefined,
  canonical: string | undefined,
  enabled: boolean
) {
  const { client } = useConnection()
  return useQuery({
    queryKey: queryKeys.gitWorktrees(projectID, currentDirectory),
    queryFn: () => {
      if (!client) throw new Error('No OpenCode client')
      if (!projectID) throw new Error('No project')
      return client.worktree.list({ projectID })
    },
    enabled: Boolean(client && projectID && enabled),
    select: (result) => resolveWorktrees(result, canonical, currentDirectory),
    staleTime: 30_000,
  })
}

export type ShellFailure = 'blocked' | 'unsupported' | 'other'

/**
 * The home agent refuses a command with 403 and older OpenCode servers do not
 * implement the shell routes at all (404). Everything else is a normal error.
 */
export function shellFailure(error: unknown): ShellFailure {
  if (error instanceof ClientError) {
    const status = (error.cause as { status?: unknown } | undefined)?.status
    if (status === 403) return 'blocked'
    if (status === 404) return 'unsupported'
  }
  return 'other'
}

async function runGitLog(
  client: OpenCodeClient,
  directory: string,
  signal: AbortSignal
): Promise<GitCommit[]> {
  const created = await client.shell.create(
    {
      location: { directory },
      command: GIT_LOG_COMMAND,
      cwd: directory,
      timeout: SHELL_TIMEOUT_MS,
    },
    { signal }
  )
  const id = created.data.id

  try {
    let status = created.data
    for (let attempt = 0; status.status === 'running' && attempt < SHELL_POLL_LIMIT; attempt += 1) {
      if (signal.aborted) throw new Error('The commit request was cancelled')
      await sleep(SHELL_POLL_MS)
      status = (await client.shell.get({ id, location: { directory } }, { signal })).data
    }
    if (status.status === 'running') throw new Error('git log did not finish in time')

    const output = await client.shell.output({ id, location: { directory } }, { signal })
    const text = output.data.output

    if (status.exit !== 0) {
      if (/does not have any commits|no commits yet/i.test(text)) return []
      const message = text.trim().split('\n').at(-1)
      throw new Error(message || `git log exited with status ${status.exit}`)
    }

    return parseOneline(text).slice(0, COMMIT_COUNT)
  } finally {
    await client.shell.remove({ id, location: { directory } }).catch(() => {})
  }
}

export function parseOneline(value: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const raw of value.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([0-9a-f]{7,40})\s+(.+)$/.exec(line)
    if (match?.[1] && match[2]) commits.push({ hash: match[1], subject: match[2] })
  }
  return commits
}

/**
 * Worktrees are only directories on the wire. The default row is the project's
 * canonical directory and the current row is the session's own directory.
 */
export function resolveWorktrees(
  worktrees: WorktreeDirectory[],
  canonical: string | undefined,
  current: string | undefined
): GitWorktree[] {
  const normalizedCanonical = canonical ? normalizePath(canonical) : undefined
  const normalizedCurrent = current ? normalizePath(current) : undefined

  const rows = worktrees.map<GitWorktree>((worktree) => {
    const path = normalizePath(worktree.directory)
    return {
      ...worktree,
      isDefault: Boolean(normalizedCanonical) && path === normalizedCanonical,
      isCurrent: Boolean(normalizedCurrent) && path === normalizedCurrent,
    }
  })

  if (canonical && normalizedCanonical && !rows.some((row) => row.isDefault)) {
    rows.unshift({
      directory: canonical,
      isDefault: true,
      isCurrent: normalizedCanonical === normalizedCurrent,
    })
  }

  return rows.sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      Number(right.isCurrent) - Number(left.isCurrent) ||
      left.directory.localeCompare(right.directory)
  )
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
