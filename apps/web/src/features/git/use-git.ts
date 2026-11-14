import { useQuery } from '@tanstack/react-query'
import type { ClaraSessionMessage, ClaraVcsFileStatus, ClaraWorktree } from '@clara/api-contract'
import { ClaraApiError } from '@clara/api-client'
import { harnessLocation, useHarnessScope } from '@/features/harness/harness-scope'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'

export type GitRange = 'working' | 'commits' | 'branch'

export type GitCommit = {
  hash: string
  authorName: string
  authorEmail: string
  authoredAt: string
  subject: string
  body: string
}

export type GitCoAuthor = {
  name: string
  email: string
}

export type ConventionalHeader = {
  type: string
  scope: string | undefined
  breaking: boolean
  description: string
}

export type GitWorktree = ClaraWorktree & {
  isDefault: boolean
  isCurrent: boolean
}

/** The time window a session owns, in milliseconds. */
export type CommitWindow = {
  /** The session's creation time. */
  since: number
  /** The newest activity in the session, omitted while a turn is running. */
  until?: number
}

export function useGitInfo(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.vcsInfo(directory, target),
    queryFn: () => client!.vcs.get(harnessLocation(directory, target)),
    enabled: Boolean(client && directory),
    select: (result) => result.data,
    staleTime: 15_000,
  })
}

export function useGitBase(directory: string | undefined, harnessID?: string) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.vcsBase(directory, target),
    queryFn: () => client!.vcs.base(harnessLocation(directory, target)),
    enabled: Boolean(client && directory),
    select: (result) => result.data,
    staleTime: 15_000,
  })
}

export function useGitChanges(
  directory: string | undefined,
  range: GitRange,
  base: string | undefined,
  harnessID?: string
) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.vcsChanges(directory, range, base, target),
    queryFn: async (): Promise<ClaraVcsFileStatus[]> => {
      if (range === 'working') {
        const result = await client!.vcs.status(harnessLocation(directory, target))
        return result.data
      }

      const result = await client!.vcs.diff({
        ...harnessLocation(directory, target),
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
 * Commits from the session's own directory inside its window. The hub builds
 * the fixed `git log` command from the window, so the browser never sends a
 * shell command.
 */
export function useGitCommits(
  directory: string | undefined,
  commitWindow: CommitWindow | undefined,
  enabled: boolean,
  harnessID?: string
) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.gitCommits(directory, commitWindow?.since, commitWindow?.until, target),
    queryFn: ({ signal }) => {
      if (!client) throw new Error('No Clara client')
      if (!directory) throw new Error('No directory')
      if (!commitWindow) throw new Error('No commit window')
      return client.git.log(
        {
          directory,
          since: commitWindow.since,
          until: commitWindow.until,
          ...(target ? { harnessID: target } : {}),
        },
        { signal }
      )
    },
    enabled: Boolean(
      client && directory && enabled && commitWindow && Number.isFinite(commitWindow.since)
    ),
    staleTime: 15_000,
    retry: false,
  })
}

export function useGitWorktrees(
  projectID: string | undefined,
  currentDirectory: string | undefined,
  canonical: string | undefined,
  enabled: boolean,
  harnessID?: string
) {
  const { client } = useConnection()
  const scope = useHarnessScope()
  const target = harnessID ?? scope
  return useQuery({
    queryKey: queryKeys.gitWorktrees(projectID, currentDirectory, target),
    queryFn: () => {
      if (!client) throw new Error('No harness client')
      if (!projectID) throw new Error('No project')
      return client.worktree.list({ projectID })
    },
    enabled: Boolean(client && projectID && enabled),
    select: (result) => resolveWorktrees(result, canonical, currentDirectory),
    staleTime: 30_000,
  })
}

export type GitHistoryFailure = 'disabled' | 'unconfigured' | 'other'

/** Map API failures to the copy the Git panel should show. */
export function gitHistoryFailure(error: unknown): GitHistoryFailure {
  if (error instanceof ClaraApiError) {
    if (error.code === 'disabled') return 'disabled'
    if (error.code === 'harness_unconfigured') return 'unconfigured'
  }
  return 'other'
}

const CONVENTIONAL_HEADER = /^([a-z]+)(?:\(([^()]+)\))?(!)?:\s+(.+)$/i
const CO_AUTHOR_TRAILER = /^co-authored-by:\s*(.*?)\s*<([^<>]+)>\s*$/i

/**
 * The newest activity in the session. Assistant and shell messages carry a
 * completion time after the commits made during their turn, so it is the upper
 * bound when present. Every other message only has a creation time.
 */
export function lastSessionActivity(messages: ClaraSessionMessage[]): number | undefined {
  let latest: number | undefined
  for (const message of messages) {
    const time =
      message.type === 'assistant' || message.type === 'shell'
        ? Math.max(message.time.created, message.time.completed ?? 0)
        : message.time.created
    if (latest === undefined || time > latest) latest = time
  }
  return latest
}

/** Split `fix(web): subject` into its conventional parts when it has them. */
export function parseConventionalHeader(subject: string): ConventionalHeader | undefined {
  const match = CONVENTIONAL_HEADER.exec(subject.trim())
  if (!match?.[1] || !match[4]) return undefined
  return {
    type: match[1].toLowerCase(),
    scope: match[2],
    breaking: Boolean(match[3]),
    description: match[4].trim(),
  }
}

/**
 * Co-author trailers are shown on their own, so remove those lines from the
 * message body. Every other trailer stays with the message.
 */
export function splitCommitBody(body: string): { message: string; coAuthors: GitCoAuthor[] } {
  const coAuthors: GitCoAuthor[] = []
  const message: string[] = []

  for (const line of body.split('\n')) {
    const match = CO_AUTHOR_TRAILER.exec(line.trim())
    if (match?.[2]) {
      const email = match[2].trim()
      coAuthors.push({ name: match[1]?.trim() || email, email })
      continue
    }
    message.push(line)
  }

  return { message: message.join('\n').trim(), coAuthors }
}

/**
 * Worktrees are only directories on the wire. The default row is the project's
 * canonical directory and the current row is the session's own directory.
 */
export function resolveWorktrees(
  worktrees: ClaraWorktree[],
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
