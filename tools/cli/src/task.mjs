#!/usr/bin/env node
// Task worktree lifecycle.
//
//   pnpm task session start my-change
//   pnpm task session list
//   pnpm task session close my-change
//
// All new work happens in a worktree under ../clara-worktrees. `close` refuses
// dirty trees, runs the checks and build, merges into the primary HEAD, and
// removes the worktree and branch.

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { fail, main, runPnpm } from './lib/router.mjs'
import {
  branchExists,
  commitCount,
  defaultTaskName,
  git,
  gitOutput,
  headShort,
  isDirty,
  managedWorktrees,
  primaryBranch,
  pruneWorktrees,
  readContext,
  requirePrimary,
  selectWorktree,
  shortCommit,
  slugify,
} from './lib/worktree.mjs'

function startSession(args) {
  const { values, positionals } = parseTaskArgs(args, {
    base: { type: 'string' },
    'no-install': { type: 'boolean', default: false },
  })
  if (positionals.length > 1) fail('Expected at most one task name.', 2)

  const context = readContext()
  requirePrimary(context)
  pruneWorktrees(context.primary.path)

  const name = slugify(positionals[0] ?? defaultTaskName())
  if (!name) fail('Task names need at least one letter or digit.', 2)

  const branch = `task/${name}`
  const path = join(context.root, name)

  if (isDirty(context.primary.path)) {
    fail(
      'The primary checkout has uncommitted changes. Commit or stash them before starting a task worktree.\n\n' +
        gitOutput(['status', '--short'], context.primary.path).trimEnd()
    )
  }
  if (existsSync(path)) fail(`Worktree path already exists: ${path}`)
  if (branchExists(branch, context.primary.path)) fail(`Branch already exists: ${branch}`)

  const base = values.base ?? 'HEAD'
  const baseCommit = shortCommit(base, context.primary.path)

  mkdirSync(context.root, { recursive: true })
  const added = git(['worktree', 'add', '-b', branch, path, base], context.primary.path, {
    allowFailure: true,
  })
  if (!added.ok) {
    process.stdout.write(added.stdout)
    process.stderr.write(added.stderr)
    fail(`Could not create the worktree at ${path}.`)
  }

  if (!values['no-install']) {
    const code = runPnpm(['install', '--frozen-lockfile', '--prefer-offline'], {
      cwd: path,
    })
    if (code !== 0) {
      fail(`Worktree created at ${path}, but pnpm install failed. Run it there, then continue.`)
    }
  }

  console.log('Created task worktree')
  console.log(`  name:   ${name}`)
  console.log(`  branch: ${branch}`)
  console.log(`  base:   ${baseCommit}`)
  console.log(`  path:   ${path}`)
  if (values['no-install']) {
    console.log('  deps:   not installed (--no-install)')
  }
  console.log('')
  console.log('Next:')
  console.log(`  cd ${path}`)
  console.log('  # do the work and commit there')
  console.log(`  cd ${context.primary.path}`)
  console.log(`  pnpm task session close ${name}`)
  return 0
}

function listSessions() {
  const context = readContext()
  pruneWorktrees(context.primary.path)

  const worktrees = managedWorktrees(context.worktrees, context.root, context.primary.path)
  if (worktrees.length === 0) {
    console.log('No task worktrees.')
    return 0
  }

  const rows = worktrees.map((worktree) => ({
    ...worktree,
    state: !existsSync(worktree.path) ? 'missing' : isDirty(worktree.path) ? 'dirty' : 'clean',
  }))
  const nameWidth = Math.max('NAME'.length, ...rows.map((row) => row.name.length))
  const branchWidth = Math.max('BRANCH'.length, ...rows.map((row) => (row.branch ?? '-').length))

  console.log(
    `${'NAME'.padEnd(nameWidth)}  ${'BRANCH'.padEnd(branchWidth)}  ${'STATE'.padEnd(6)}  PATH`
  )
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(nameWidth)}  ${(row.branch ?? '-').padEnd(branchWidth)}  ${row.state.padEnd(6)}  ${row.path}`
    )
  }
  return 0
}

function closeSession(args) {
  const { positionals } = parseTaskArgs(args, {})
  if (positionals.length > 1) fail('Expected at most one task name.', 2)

  const context = readContext()
  requirePrimary(context)
  pruneWorktrees(context.primary.path)

  const target = selectWorktree(
    context.worktrees,
    context.root,
    context.primary.path,
    positionals[0]
  )
  const branch = target.branch
  if (!branch?.startsWith('task/')) {
    fail(`${target.path} is not a task worktree (branch: ${branch ?? 'detached'}).`)
  }
  if (!existsSync(target.path)) fail(`The worktree directory is missing: ${target.path}`)

  if (isDirty(target.path)) {
    fail(
      'The worktree has uncommitted changes. Commit them before closing.\n\n' +
        gitOutput(['status', '--short'], target.path).trimEnd()
    )
  }
  if (isDirty(context.primary.path)) {
    fail(
      'The primary checkout has uncommitted changes. Commit or stash them before closing.\n\n' +
        gitOutput(['status', '--short'], context.primary.path).trimEnd()
    )
  }

  const into = primaryBranch(context)
  const ahead = commitCount(into, branch, context.primary.path)

  if (ahead === 0) {
    removeWorktree(context, target)
    deleteBranch(context, branch)
    console.log(`No commits to merge from ${branch}. Removed ${target.path}.`)
    return 0
  }

  const installed = runPnpm(['install', '--frozen-lockfile', '--prefer-offline'], {
    cwd: target.path,
  })
  if (installed !== 0)
    fail(`pnpm install failed in ${target.path}. The worktree was left in place.`)

  const checked = runPnpm(['check'], { cwd: target.path })
  if (checked !== 0) fail(`pnpm check failed in ${target.path}. The worktree was left in place.`)

  const built = runPnpm(['build'], { cwd: target.path })
  if (built !== 0) fail(`pnpm build failed in ${target.path}. The worktree was left in place.`)

  if (isDirty(target.path)) {
    fail('The worktree changed while checks ran. Commit or revert those changes and retry.')
  }
  if (isDirty(context.primary.path)) {
    fail('The primary checkout changed while checks ran. Commit or stash those changes and retry.')
  }

  const message = `chore: merge ${branch}`
  const merged = git(['merge', '--no-ff', branch, '-m', message], context.primary.path, {
    allowFailure: true,
  })
  if (!merged.ok) {
    process.stdout.write(merged.stdout)
    process.stderr.write(merged.stderr)
    git(['merge', '--abort'], context.primary.path, { allowFailure: true })
    fail(
      `Could not merge ${branch} into ${into}. The merge was aborted and the worktree was left in place.`
    )
  }
  process.stdout.write(merged.stdout)

  removeWorktree(context, target)
  deleteBranch(context, branch)

  console.log('Closed task worktree')
  console.log(`  merged:  ${branch} -> ${into}`)
  console.log(`  head:    ${headShort(context.primary.path)}`)
  console.log(`  removed: ${target.path}`)
  return 0
}

function removeWorktree(context, target) {
  const removed = git(['worktree', 'remove', '--force', target.path], context.primary.path, {
    allowFailure: true,
  })
  if (!removed.ok) {
    process.stdout.write(removed.stdout)
    process.stderr.write(removed.stderr)
    fail(
      `Could not remove ${target.path}. The merge is intact; remove the worktree and branch manually.`
    )
  }
}

function deleteBranch(context, branch) {
  const deleted = git(['branch', '-d', branch], context.primary.path, {
    allowFailure: true,
  })
  if (!deleted.ok) {
    process.stdout.write(deleted.stdout)
    process.stderr.write(deleted.stderr)
    fail(`Could not delete ${branch}. The worktree was removed; delete the branch manually.`)
  }
}

function parseTaskArgs(args, options) {
  try {
    return parseArgs({ args, allowPositionals: true, options, strict: true })
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2)
  }
}

const task = {
  name: 'task',
  summary: 'Repository task lifecycle',
  examples: [
    'pnpm task session start my-change',
    'pnpm task session list',
    'pnpm task session close my-change',
  ],
  commands: [
    {
      name: 'session',
      summary: 'Manage task worktrees',
      commands: [
        {
          name: 'start',
          summary: 'Create a worktree and branch for a new task',
          usage: '[name] [--base <ref>] [--no-install]',
          options: [
            {
              flags: '--base <ref>',
              description: 'Start from this commit or branch (default HEAD)',
            },
            { flags: '--no-install', description: 'Skip pnpm install in the new worktree' },
          ],
          run: startSession,
        },
        {
          name: 'list',
          summary: 'List task worktrees',
          run: listSessions,
        },
        {
          name: 'close',
          summary: 'Check, merge, and remove a task worktree',
          usage: '[name]',
          options: [
            {
              flags: '<name>',
              description: 'Required when several task worktrees exist',
            },
          ],
          run: closeSession,
        },
      ],
    },
  ],
}

await main(task)
