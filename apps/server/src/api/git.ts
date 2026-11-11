import type { ShellInfo } from '@opencode/client'
import type { GitCommit } from '@clara/api-contract'
import { forward, forwardResult, query } from './harness.ts'
import type { ApiDependencies } from './context.ts'

const GIT_LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e'
const COMMIT_COUNT = 10
const SHELL_TIMEOUT_MS = 10_000
const SHELL_POLL_MS = 150
const SHELL_POLL_LIMIT = Math.ceil(SHELL_TIMEOUT_MS / SHELL_POLL_MS) + 2
const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'
const HASH_PATTERN = /^[0-9a-f]{7,40}$/

export type GitLogInput = {
  directory: string
  since: number
  until?: number
}

/**
 * Git history is the one host command Clara runs. The command is fixed here,
 * built only from validated timestamps, and scoped to the requested directory.
 * The hub no longer exposes an arbitrary shell proxy.
 */
export async function loadGitLog(
  deps: ApiDependencies,
  input: GitLogInput,
  signal: AbortSignal
): Promise<GitCommit[]> {
  const location = { directory: input.directory }
  const created = await forwardResult<ShellInfo>(
    deps,
    {
      method: 'POST',
      path: '/api/shell',
      search: query({ location }),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: gitLogCommand(input),
        cwd: input.directory,
        timeout: SHELL_TIMEOUT_MS,
      }),
    },
    signal,
    true
  )

  try {
    let status = created
    for (let attempt = 0; status.status === 'running' && attempt < SHELL_POLL_LIMIT; attempt += 1) {
      if (signal.aborted) throw new Error('The commit request was cancelled')
      await sleep(SHELL_POLL_MS)
      status = await forwardResult<ShellInfo>(
        deps,
        {
          method: 'GET',
          path: `/api/shell/${encodeURIComponent(status.id)}`,
          search: query({ location }),
        },
        signal,
        true
      )
    }
    if (status.status === 'running') throw new Error('git log did not finish in time')

    const output = await forwardResult<{ output: string }>(
      deps,
      {
        method: 'GET',
        path: `/api/shell/${encodeURIComponent(status.id)}/output`,
        search: query({ location }),
      },
      signal,
      true
    )
    const text = output.output

    if (status.exit !== 0) {
      if (/does not have any commits|no commits yet/i.test(text)) return []
      const message = text.trim().split('\n').at(-1)
      throw new Error(message || `git log exited with status ${status.exit}`)
    }

    return parseGitLog(text).slice(0, COMMIT_COUNT)
  } finally {
    await forward(
      deps,
      {
        method: 'DELETE',
        path: `/api/shell/${encodeURIComponent(created.id)}`,
        search: query({ location }),
      },
      AbortSignal.timeout(2_000)
    ).catch(() => undefined)
  }
}

export function gitLogCommand(input: { since: number; until?: number }): string {
  if (!Number.isFinite(input.since)) throw new Error('The session start is not a timestamp')
  const since = new Date(input.since).toISOString()
  const until =
    input.until !== undefined && Number.isFinite(input.until)
      ? ` --until=${new Date(input.until).toISOString()}`
      : ''
  return `git log --since=${since}${until} -n ${COMMIT_COUNT} --format=${GIT_LOG_FORMAT}`
}

export function parseGitLog(value: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const raw of value.split(RECORD_SEPARATOR)) {
    const record = raw.replace(/^\r?\n/, '').trimEnd()
    if (!record.trim()) continue

    const [hash, authorName, authorEmail, authoredAt, subject, ...body] =
      record.split(FIELD_SEPARATOR)
    if (!hash || !HASH_PATTERN.test(hash)) continue

    commits.push({
      hash,
      authorName: authorName?.trim() ?? '',
      authorEmail: authorEmail?.trim() ?? '',
      authoredAt: authoredAt?.trim() ?? '',
      subject: subject?.trim() ?? '',
      body: body.join(FIELD_SEPARATOR).trim(),
    })
  }
  return commits
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
