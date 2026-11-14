import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ClaraFileDiff,
  ClaraVcsBaseOutput,
  ClaraVcsDiffOutput,
  ClaraVcsFileStatus,
  ClaraVcsGetOutput,
  ClaraVcsStatusOutput,
  ClaraWorktree,
  GitCommit,
} from '@clara/api-contract'
import { AdapterError } from './errors.ts'

const run = promisify(execFile)
const TIMEOUT_MS = 10_000
const MAX_BUFFER = 8 * 1024 * 1024
const MAX_PATCH_CHARS = 2 * 1024 * 1024
const MAX_UNTRACKED_FILES = 50
const COMMIT_COUNT = 10
const GIT_LOG_FORMAT = '%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e'
const FIELD_SEPARATOR = '\x1f'
const RECORD_SEPARATOR = '\x1e'
const HASH_PATTERN = /^[0-9a-f]{7,40}$/

type GitResult = {
  ok: boolean
  stdout: string
  stderr: string
}

async function git(directory: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await run('git', args, {
      cwd: directory,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    })
    return { ok: true, stdout, stderr }
  } catch (cause) {
    const failed = cause as { stdout?: unknown; stderr?: unknown }
    return {
      ok: false,
      stdout: typeof failed.stdout === 'string' ? failed.stdout : '',
      stderr: typeof failed.stderr === 'string' ? failed.stderr : '',
    }
  }
}

export async function isGitRepository(directory: string): Promise<boolean> {
  const result = await git(directory, ['rev-parse', '--is-inside-work-tree'])
  return result.ok && result.stdout.trim() === 'true'
}

export async function vcsInfo(directory: string): Promise<ClaraVcsGetOutput> {
  if (!(await isGitRepository(directory))) {
    return { location: { directory }, data: { branch: {} } }
  }
  const current = await git(directory, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const defaultBranch = await defaultBranchName(directory)
  const branch = current.stdout.trim()
  return {
    location: { directory },
    data: {
      provider: 'git',
      branch: {
        ...(branch && branch !== 'HEAD' ? { current: branch } : {}),
        ...(defaultBranch ? { default: defaultBranch } : {}),
      },
    },
  }
}

export async function vcsBase(directory: string): Promise<ClaraVcsBaseOutput> {
  if (!(await isGitRepository(directory))) {
    return { location: { directory }, data: null }
  }
  const head = await git(directory, ['rev-parse', '--verify', 'HEAD'])
  if (!head.ok) return { location: { directory }, data: null }
  const branch = (await defaultBranchName(directory)) ?? 'main'
  const mergeBase = await git(directory, ['merge-base', 'HEAD', branch])
  if (!mergeBase.ok || !mergeBase.stdout.trim()) {
    return { location: { directory }, data: null }
  }
  return {
    location: { directory },
    data: { name: branch, ref: mergeBase.stdout.trim(), source: 'default' },
  }
}

export async function vcsStatus(directory: string): Promise<ClaraVcsStatusOutput> {
  if (!(await isGitRepository(directory))) {
    return { location: { directory }, data: [] }
  }
  const status = await git(directory, ['status', '--porcelain=v1', '--untracked-files=all', '-z'])
  const tracked = await numstat(directory)
  const files = new Map<string, ClaraVcsFileStatus>()
  const tokens = status.stdout.split('\0')

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const code = token.slice(0, 2)
    const file = token.slice(3)
    if (!file) continue
    if (code.includes('R') || code.includes('C')) index += 1
    const entryType = code.includes('?') ? 'added' : code.includes('D') ? 'deleted' : 'modified'
    const counts = tracked.get(file)
    files.set(file, {
      file,
      additions:
        counts?.additions ?? (entryType === 'added' ? countLines(join(directory, file)) : 0),
      deletions: counts?.deletions ?? 0,
      status: entryType,
    })
  }

  return {
    location: { directory },
    data: [...files.values()].sort((a, b) => a.file.localeCompare(b.file)),
  }
}

export async function vcsDiff(
  directory: string,
  input: { mode: 'working' | 'branch' | 'committed'; base?: string; context?: number }
): Promise<ClaraVcsDiffOutput> {
  if (!(await isGitRepository(directory))) {
    return { location: { directory }, data: [] }
  }
  const context = Math.min(Math.max(input.context ?? 3, 0), 20)
  const base = input.base ?? (await defaultBranchName(directory)) ?? 'HEAD'
  const args = ['diff', '--no-color', '--no-ext-diff', `--unified=${context}`]

  if (input.mode === 'committed') args.push(`${base}..HEAD`)
  else if (input.mode === 'branch') args.push(base)
  else {
    const head = await git(directory, ['rev-parse', '--verify', 'HEAD'])
    if (head.ok) args.push('HEAD')
  }

  const diff = await git(directory, args)
  const entries = parsePatch(diff.stdout)
  if (input.mode !== 'committed') {
    for (const untracked of await untrackedPatches(directory)) entries.push(untracked)
  }
  return {
    location: { directory },
    data: mergePatches(entries).slice(0, 200),
  }
}

export async function worktrees(directory: string): Promise<ClaraWorktree[]> {
  if (!(await isGitRepository(directory))) return []
  const result = await git(directory, ['worktree', 'list', '--porcelain'])
  if (!result.ok) return []
  const entries: ClaraWorktree[] = []
  for (const block of result.stdout.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const path = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!path) continue
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch '.length)
    entries.push({ directory: path, ...(branch ? { strategy: 'git' } : {}) })
  }
  return entries
}

export async function gitLog(
  directory: string,
  input: { since: number; until?: number }
): Promise<GitCommit[]> {
  if (!Number.isFinite(input.since)) {
    throw new AdapterError(400, 'invalid_request', 'A session start timestamp is required')
  }
  const since = new Date(input.since).toISOString()
  const args = [
    'log',
    `--since=${since}`,
    ...(input.until !== undefined && Number.isFinite(input.until)
      ? [`--until=${new Date(input.until).toISOString()}`]
      : []),
    '-n',
    String(COMMIT_COUNT),
    `--format=${GIT_LOG_FORMAT}`,
  ]
  const result = await git(directory, args)
  if (!result.ok) {
    if (/does not have any commits|no commits yet|unknown revision/i.test(result.stderr)) return []
    return []
  }
  return parseGitLog(result.stdout).slice(0, COMMIT_COUNT)
}

async function defaultBranchName(directory: string): Promise<string | undefined> {
  const remote = await git(directory, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.ok && remote.stdout.trim()) return remote.stdout.trim().replace(/^origin\//, '')
  const config = await git(directory, ['config', '--get', 'init.defaultBranch'])
  if (config.ok && config.stdout.trim()) return config.stdout.trim()
  for (const candidate of ['main', 'master']) {
    const exists = await git(directory, ['rev-parse', '--verify', candidate])
    if (exists.ok) return candidate
  }
  return undefined
}

async function numstat(
  directory: string
): Promise<Map<string, { additions: number; deletions: number }>> {
  const result = await git(directory, ['diff', '--numstat', 'HEAD'])
  const map = new Map<string, { additions: number; deletions: number }>()
  if (!result.ok) return map
  for (const line of result.stdout.split('\n')) {
    const [added, deleted, ...pathParts] = line.split('\t')
    const file = pathParts.join('\t')
    if (!file) continue
    map.set(file, {
      additions: Number.isFinite(Number(added)) ? Number(added) : 0,
      deletions: Number.isFinite(Number(deleted)) ? Number(deleted) : 0,
    })
  }
  return map
}

function parsePatch(value: string): ClaraFileDiff[] {
  const patches: ClaraFileDiff[] = []
  const chunks = value.split(/\n(?=diff --git )/)
  for (const chunk of chunks) {
    if (!chunk.startsWith('diff --git ')) continue
    const file = patchPath(chunk)
    if (!file) continue
    const status = chunk.includes('new file mode')
      ? 'added'
      : chunk.includes('deleted file mode')
        ? 'deleted'
        : 'modified'
    let additions = 0
    let deletions = 0
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
      if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
    }
    patches.push({ file, patch: chunk.slice(0, MAX_PATCH_CHARS), additions, deletions, status })
  }
  return patches
}

function patchPath(chunk: string): string | undefined {
  const lines = chunk.split('\n')
  const plus = lines.find((line) => line.startsWith('+++ '))?.slice(4)
  const minus = lines.find((line) => line.startsWith('--- '))?.slice(4)
  const raw = plus && plus !== '/dev/null' ? plus : minus
  if (!raw || raw === '/dev/null') return undefined
  return unquoteGitPath(raw).replace(/^[ab]\//, '')
}

function unquoteGitPath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value
  return value
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
}

async function untrackedPatches(directory: string): Promise<ClaraFileDiff[]> {
  const result = await git(directory, ['ls-files', '--others', '--exclude-standard', '-z'])
  if (!result.ok) return []
  const patches: ClaraFileDiff[] = []
  const files = result.stdout.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES)
  for (const file of files) {
    const content = readTextFile(join(directory, file))
    if (content === undefined) continue
    const lines = content.split('\n')
    if (lines.at(-1) === '') lines.pop()
    const body = lines.map((line) => `+${line}`).join('\n')
    patches.push({
      file,
      patch: [
        `diff --git a/${file} b/${file}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${file}`,
        `@@ -0,0 +1,${lines.length} @@`,
        body,
      ].join('\n'),
      additions: lines.length,
      deletions: 0,
      status: 'added',
    })
  }
  return patches
}

function readTextFile(path: string): string | undefined {
  try {
    const content = readFileSync(path, 'utf8')
    if (content.includes('\0') || content.length > 256 * 1024) return undefined
    return content
  } catch {
    return undefined
  }
}

function countLines(path: string): number {
  const content = readTextFile(path)
  if (content === undefined) return 0
  return content.split('\n').filter((line) => line.length > 0).length
}

function mergePatches(entries: ClaraFileDiff[]): ClaraFileDiff[] {
  const byFile = new Map<string, ClaraFileDiff>()
  for (const entry of entries) byFile.set(entry.file, entry)
  return [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file))
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
