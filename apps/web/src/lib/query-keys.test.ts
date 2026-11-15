import { describe, expect, it } from 'vitest'
import { harnessKey, queryKeys } from './query-keys'

describe('queryKeys project aggregates', () => {
  it('keeps presence and stats out of the session-list prefix', () => {
    expect(queryKeys.projectPresence('project')[0]).not.toBe('sessions')
    expect(queryKeys.projectStats('project')[0]).not.toBe('sessions')
  })
})

describe('queryKeys session lists', () => {
  it('keeps archived lists out of the active session prefix', () => {
    expect(queryKeys.archivedSessions('project')).toEqual(['archived-sessions', 'project'])
    expect(queryKeys.archivedSessions(null)).toEqual(['archived-sessions', 'all'])
    expect(queryKeys.archivedSessions('project')[0]).not.toBe('sessions')
    expect(queryKeys.archivedSessions('project').slice(0, 1)).toEqual(
      queryKeys.archivedSessionsRoot
    )
  })
})

describe('queryKeys harness scope', () => {
  it('marks an omitted harness as unknown', () => {
    expect(harnessKey(undefined)).toBe('none')
    expect(queryKeys.agents()).toEqual(['agents', 'none'])
    expect(queryKeys.models(undefined)).toEqual(['models', 'none'])
    expect(queryKeys.providers()).toEqual(['providers', 'none'])
    expect(queryKeys.commands()).toEqual(['commands', 'none'])
  })

  it('keeps catalogs and location data separate per harness', () => {
    expect(queryKeys.agents('one')).not.toEqual(queryKeys.agents('two'))
    expect(queryKeys.models('one')).toEqual(['models', 'one'])
    expect(queryKeys.skills('/repo', 'one')).toEqual(['skills', '/repo', 'one'])
    expect(queryKeys.references('/repo', 'two')).toEqual(['references', '/repo', 'two'])
    expect(queryKeys.vcsInfo('/repo', 'one')).toEqual(['vcs', 'info', '/repo', 'one'])
    expect(queryKeys.vcsChanges('/repo', 'working', undefined, 'one')).toEqual([
      'vcs',
      'changes',
      '/repo',
      'working',
      '',
      'one',
    ])
  })

  it('scopes git history and worktrees by harness', () => {
    expect(queryKeys.gitCommits('/repo', 1, undefined, 'one')).toEqual([
      'git',
      'commits',
      '/repo',
      1,
      0,
      'one',
    ])
    expect(queryKeys.gitWorktrees('project', '/repo', 'one')).toEqual([
      'git',
      'worktrees',
      'project',
      '/repo',
      'one',
    ])
  })

  it('scopes pending permissions but keeps a cross-harness prefix', () => {
    expect(queryKeys.permissionsFor('/repo', 'one')).toEqual(['permissions', '/repo', 'one'])
    expect(queryKeys.permissionsFor('/repo', undefined)).toEqual(['permissions', '/repo', 'none'])
    expect(queryKeys.permissionsFor('/repo', 'one').slice(0, 1)).toEqual(queryKeys.permissions)
  })
})
