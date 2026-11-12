import type { GitCommit } from '@clara/api-contract'
import type { OpenCodeGateway } from './opencode.ts'

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

/** Run the fixed git history command through OpenCode's shell API. */
export async function loadGitLog(
  gateway: OpenCodeGateway,
  input: GitLogInput,
  signal: AbortSignal
): Promise<GitCommit[]> {
  const location = { directory: input.directory }
  const created = await gateway.client.shell.create(
    {
      location,
      command: gitLogCommand(input),
      cwd: input.directory,
      timeout: SHELL_TIMEOUT_MS,
    },
    { signal }
  )

  try {
    let status = created.data
    for (let attempt = 0; status.status === 'running' && attempt < SHELL_POLL_LIMIT; attempt += 1) {
      if (signal.aborted) throw new Error('The commit request was cancelled')
      await sleep(SHELL_POLL_MS)
      status = (await gateway.client.shell.get({ id: status.id, location }, { signal })).data
    }
    if (status.status === 'running') throw new Error('git log did not finish in time')

    const output = (await gateway.client.shell.output({ id: status.id, location }, { signal })).data
    if (status.exit !== 0) {
      if (/does not have any commits|no commits yet/i.test(output.output)) return []
      const message = output.output.trim().split('\n').at(-1)
      throw new Error(message || `git log exited with status ${status.exit}`)
    }
    return parseGitLog(output.output).slice(0, COMMIT_COUNT)
  } finally {
    await gateway.client.shell
      .remove({ id: created.data.id, location }, { signal: AbortSignal.timeout(2_000) })
      .catch(() => undefined)
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
