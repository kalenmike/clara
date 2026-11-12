// Git worktree helpers for `pnpm task session`.
//
// The pure helpers are exported for tests. Everything that touches git stays
// here so the command handlers read as a sequence of steps.

import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { root as repoRoot } from './router.mjs'

export function parseWorktreeList(output) {
  return output
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.trim().split(/\r?\n/)
      const worktree = lines.find((line) => line.startsWith('worktree '))
      if (!worktree) return undefined
      const branch = lines.find((line) => line.startsWith('branch '))
      return {
        path: worktree.slice('worktree '.length),
        branch: branch ? branch.slice('branch '.length).replace(/^refs\/heads\//, '') : undefined,
      }
    })
    .filter(Boolean)
}

export function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/^task\//, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

export function defaultTaskName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return [
    'task',
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  ].join('-')
}

export function worktreesDirectory(primaryRoot, env = process.env) {
  const override = env.CLARA_WORKTREES_DIR?.trim()
  return override ? resolve(override) : join(dirname(primaryRoot), 'clara-worktrees')
}

export function managedWorktrees(worktrees, root, primaryPath) {
  const normalizedRoot = resolve(root)
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep
  const normalizedPrimary = resolve(primaryPath)

  return worktrees
    .filter((worktree) => resolve(worktree.path) !== normalizedPrimary)
    .filter(
      (worktree) =>
        resolve(worktree.path).startsWith(prefix) || worktree.branch?.startsWith('task/')
    )
    .map((worktree) => ({
      ...worktree,
      path: resolve(worktree.path),
      name: worktree.branch?.startsWith('task/')
        ? worktree.branch.slice('task/'.length)
        : basename(worktree.path),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export function selectWorktree(worktrees, root, primaryPath, name) {
  const managed = managedWorktrees(worktrees, root, primaryPath)

  if (name) {
    const wanted = slugify(name)
    const match = managed.find(
      (worktree) =>
        worktree.name === wanted ||
        worktree.branch === `task/${wanted}` ||
        basename(worktree.path) === wanted
    )
    if (match) return match

    const known = managed.length
      ? ` Known task worktrees: ${managed.map((worktree) => worktree.name).join(', ')}.`
      : ' There are no task worktrees.'
    throw new Error(`No task worktree named "${wanted}".${known}`)
  }

  if (managed.length === 1) return managed[0]
  if (managed.length === 0) {
    throw new Error('There are no task worktrees. Start one with `pnpm task session start`.')
  }
  throw new Error(
    `Several task worktrees exist; name one: ${managed
      .map((worktree) => worktree.name)
      .join(', ')}.`
  )
}

export function readContext(cwd = process.cwd()) {
  const current = resolve(gitOutput(['rev-parse', '--show-toplevel'], cwd).trim())
  const worktrees = parseWorktreeList(gitOutput(['worktree', 'list', '--porcelain'], current))
  const primary = worktrees[0]
  if (!primary) throw new Error('Could not determine the primary git worktree.')

  return {
    current,
    primary: { ...primary, path: resolve(primary.path) },
    worktrees,
    root: worktreesDirectory(primary.path),
  }
}

export function requirePrimary(context) {
  if (context.current !== context.primary.path) {
    throw new Error(`Run this command from the primary checkout: ${context.primary.path}`)
  }
}

export function isDirty(path) {
  return git(['status', '--porcelain'], path).stdout.trim().length > 0
}

export function shortCommit(ref, cwd = repoRoot) {
  return gitOutput(['rev-parse', '--short', ref], cwd).trim()
}

export function primaryBranch(context) {
  return gitOutput(['symbolic-ref', '--quiet', '--short', 'HEAD'], context.primary.path).trim()
}

export function branchExists(branch, cwd = repoRoot) {
  return git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd, {
    allowFailure: true,
  }).ok
}

export function commitCount(from, to, cwd = repoRoot) {
  return Number(gitOutput(['rev-list', '--count', `${from}..${to}`], cwd).trim())
}

export function headShort(cwd = repoRoot) {
  return gitOutput(['rev-parse', '--short', 'HEAD'], cwd).trim()
}

export function pruneWorktrees(cwd = repoRoot) {
  git(['worktree', 'prune'], cwd, { allowFailure: true })
}

export function gitOutput(args, cwd = repoRoot) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw new Error(`git ${args.join(' ')}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim())
  }
  return result.stdout
}

export function git(args, cwd = repoRoot, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw new Error(`git ${args.join(' ')}: ${result.error.message}`)

  const ok = result.status === 0
  if (!ok && !allowFailure) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim())
  }

  return {
    ok,
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}
