import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  catalogPath,
  localWorkspacePath,
  needsExplicitWorkspace,
  ownsWorkspace,
  resolveWorkspace,
} from './workspace.ts'

test('prefers the container workspace override', () => {
  assert.equal(
    resolveWorkspace(
      { worktree: '/session', directory: '/project' },
      { CLARA_ENGINE_WORKSPACE: '/mounted' },
      '/cwd'
    ),
    '/mounted'
  )
})

test('reads the historical workspace variable', () => {
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

test('maps a missing engine workspace to the adapter workspace', () => {
  const current = mkdtempSync(join(tmpdir(), 'clara-adapter-workspace-'))
  try {
    assert.equal(localWorkspacePath('/engine/host/workspace', current), current)
    assert.equal(localWorkspacePath(current, current), current)
  } finally {
    rmSync(current, { recursive: true, force: true })
  }
})

test('owns runs by origin workspace and tolerates a remote engine path', () => {
  const current = mkdtempSync(join(tmpdir(), 'clara-adapter-owns-'))
  const other = mkdtempSync(join(tmpdir(), 'clara-adapter-other-'))
  try {
    assert.equal(ownsWorkspace({ origin_workspace: current }, current), true)
    assert.equal(ownsWorkspace({ origin_workspace: '/engine/host/workspace' }, current), true)
    assert.equal(ownsWorkspace({ workspace: '/engine/host/workspace' }, current), true)
    assert.equal(ownsWorkspace({ workspace: other }, current), false)
  } finally {
    rmSync(current, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
})

test('falls back to the legacy workspace fields', () => {
  assert.equal(resolveWorkspace({ workspace: '/legacy' }, {}, '/cwd'), '/legacy')
  assert.equal(resolveWorkspace({ location: { directory: '/location' } }, {}, '/cwd'), '/location')
})

test('falls back to the current directory and ignores blanks', () => {
  assert.equal(resolveWorkspace(undefined, {}, '/cwd'), '/cwd')
  assert.equal(resolveWorkspace({ worktree: '  ' }, {}, '/cwd'), '/cwd')
})

test('detects an orchestrator that needs an explicit workspace', () => {
  const legacy = Object.assign(new Error('workspace query is required'), {
    code: 'workspace_required',
  })
  assert.equal(needsExplicitWorkspace(legacy), true)
  assert.equal(needsExplicitWorkspace(new Error('other')), false)
  assert.equal(needsExplicitWorkspace('workspace_required'), false)
})

test('addresses the configured catalog only for a legacy orchestrator', () => {
  assert.equal(catalogPath(), '/v1/catalog')
  assert.equal(catalogPath('/workspace/clara'), '/v1/catalog?workspace=%2Fworkspace%2Fclara')
})
