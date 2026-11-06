import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultTaskName,
  managedWorktrees,
  parseWorktreeList,
  selectWorktree,
  slugify,
  worktreesDirectory,
} from '../lib/worktree.mjs'

const porcelain = `worktree /work/clara
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /work/clara-worktrees/foo
HEAD 2222222222222222222222222222222222222222
branch refs/heads/task/foo

worktree /work/elsewhere/bar
HEAD 3333333333333333333333333333333333333333
branch refs/heads/task/bar

worktree /work/clara-worktrees/other
HEAD 4444444444444444444444444444444444444444
branch refs/heads/feature/other
`

test('parses porcelain worktree output', () => {
  const worktrees = parseWorktreeList(porcelain)
  assert.equal(worktrees.length, 4)
  assert.deepEqual(worktrees[0], { path: '/work/clara', branch: 'main' })
  assert.deepEqual(worktrees[2], { path: '/work/elsewhere/bar', branch: 'task/bar' })
})

test('normalizes task names', () => {
  assert.equal(slugify('My Feature!'), 'my-feature')
  assert.equal(slugify('task/Foo_Bar'), 'foo-bar')
  assert.equal(slugify('  '), '')
})

test('generates a timestamped default name', () => {
  const date = new Date(2026, 10, 6, 1, 2, 3)
  assert.equal(defaultTaskName(date), 'task-20261106-010203')
})

test('places worktrees next to the primary checkout by default', () => {
  assert.equal(worktreesDirectory('/work/clara', {}), '/work/clara-worktrees')
  assert.equal(worktreesDirectory('/work/clara', { CLARA_WORKTREES_DIR: '/tmp/wt' }), '/tmp/wt')
})

test('keeps task branches and worktrees under the managed directory', () => {
  const worktrees = managedWorktrees(
    parseWorktreeList(porcelain),
    '/work/clara-worktrees',
    '/work/clara'
  )
  assert.deepEqual(
    worktrees.map((worktree) => [worktree.name, worktree.branch]),
    [
      ['bar', 'task/bar'],
      ['foo', 'task/foo'],
      ['other', 'feature/other'],
    ]
  )
})

test('selects the only worktree or a named one', () => {
  const worktrees = parseWorktreeList(porcelain)
  assert.equal(selectWorktree(worktrees, '/work/clara-worktrees', '/work/clara', 'foo').name, 'foo')

  const only = managedWorktrees(
    parseWorktreeList(
      `worktree /work/clara
branch refs/heads/main

worktree /work/clara-worktrees/only
branch refs/heads/task/only
`
    ),
    '/work/clara-worktrees',
    '/work/clara'
  )
  assert.equal(selectWorktree(only, '/work/clara-worktrees', '/work/clara').name, 'only')
})

test('requires a name when several worktrees exist', () => {
  assert.throws(
    () => selectWorktree(parseWorktreeList(porcelain), '/work/clara-worktrees', '/work/clara'),
    /Several task worktrees exist/
  )
  assert.throws(
    () =>
      selectWorktree(
        parseWorktreeList(porcelain),
        '/work/clara-worktrees',
        '/work/clara',
        'missing'
      ),
    /No task worktree named "missing"/
  )
})
