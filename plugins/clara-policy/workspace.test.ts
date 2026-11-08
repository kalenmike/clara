import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkspace } from './workspace.ts'

test('prefers the container workspace override', () => {
  assert.equal(
    resolveWorkspace(
      { worktree: '/session', directory: '/project' },
      { CLARA_ORCHESTRATION_WORKSPACE: '/mounted' },
      '/cwd'
    ),
    '/mounted'
  )
})

test('prefers the session worktree over its directory', () => {
  assert.equal(
    resolveWorkspace({ worktree: '/worktree', directory: '/worktree/src' }, {}, '/cwd'),
    '/worktree'
  )
})

test('uses the tool directory when no worktree is provided', () => {
  assert.equal(resolveWorkspace({ directory: '/project' }, {}, '/cwd'), '/project')
})

test('falls back to the legacy workspace fields', () => {
  assert.equal(resolveWorkspace({ workspace: '/legacy' }, {}, '/cwd'), '/legacy')
  assert.equal(resolveWorkspace({ location: { directory: '/location' } }, {}, '/cwd'), '/location')
})

test('falls back to the current directory and ignores blanks', () => {
  assert.equal(resolveWorkspace(undefined, {}, '/cwd'), '/cwd')
  assert.equal(resolveWorkspace({ worktree: '  ' }, {}, '/cwd'), '/cwd')
})
