import type { GitCommit } from '@clara/api-contract'
import type { OpenCodeClient } from './opencode.ts'

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

type ShellInfo = {
  id: string
  status: 'running' | 'exited' | 'timeout' | 'killed'
  exit?: number
  command: string
  cwd: string
}

/** Run the fixed git history command through OpenCode's shell API. */
export async function loadGitLog(
  client: OpenCodeClient,
  input: GitLogInput,
  signal: AbortSignal
): Promise<GitCommit[]> {
  const location = { directory: input.directory }
  const search = new URLSearchParams({ 'location[directory]': input.directory }).toString()
  const created = await readData<ShellInfo>(
    client,
    {
      method: 'POST',
      path: '/api/shell',
      search: `?${search}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: gitLogCommand(input),
        cwd: input.directory,
        timeout: SHELL_TIMEOUT_MS,
      }),
    },
    signal
  )

  try {
    let status = created
    for (let attempt = 0; status.status === 'running' && attempt < SHELL_POLL_LIMIT; attempt += 1) {
      if (signal.aborted) throw new Error('The commit request was cancelled')
      await sleep(SHELL_POLL_MS)
      status = await readData<ShellInfo>(
        client,
        {
          method: 'GET',
          path: `/api/shell/${encodeURIComponent(status.id)}`,
          search: `?${search}`,
        },
        signal
      )
    }
    if (status.status === 'running') throw new Error('git log did not finish in time')

    const output = await readData<{ output: string }>(
      client,
      {
        method: 'GET',
        path: `/api/shell/${encodeURIComponent(status.id)}/output`,
        search: `?${search}`,
      },
      signal
    )
    if (status.exit !== 0) {
      if (/does not have any commits|no commits yet/i.test(output.output)) return []
      const message = output.output.trim().split('\n').at(-1)
      throw new Error(message || `git log exited with status ${status.exit}`)
    }
    return parseGitLog(output.output).slice(0, COMMIT_COUNT)
  } finally {
    await client
      .request(
        {
          method: 'DELETE',
          path: `/api/shell/${encodeURIComponent(created.id)}`,
          search: `?${search}`,
        },
        AbortSignal.timeout(2_000)
      )
      .catch(() => undefined)
    void location
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

async function readData<T>(
  client: OpenCodeClient,
  request: Parameters<OpenCodeClient['request']>[0],
  signal: AbortSignal
): Promise<T> {
  const response = await client.request(request, signal)
  if (!response.ok) throw new Error(`OpenCode responded with ${response.status}`)
  const body = (await response.json()) as { data?: T }
  if (body.data === undefined) throw new Error('OpenCode returned no data')
  return body.data
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
