import { describe, expect, it } from 'vitest'
import type { ClaraProjectWorkspace, ClaraSession } from '@clara/api-contract'
import { latestSessionInWorkspace } from './session-workspace'

function makeWorkspace(input: {
  id: string
  harnessID?: string
  directory?: string
  canonical?: string
}): ClaraProjectWorkspace {
  const directory = input.directory ?? `/work/${input.id}`
  const harnessID = input.harnessID ?? 'harness_a'
  return {
    id: input.id,
    harnessID,
    harnessKind: 'test',
    harnessLabel: harnessID,
    online: true,
    active: false,
    directory,
    ...(input.canonical ? { canonical: input.canonical } : {}),
    projectIDs: [`harness-project-${input.id}`],
    linked: true,
  }
}

function makeSession(input: {
  id: string
  updated: number
  harnessID?: string
  workspaceID?: string
  directory?: string
  modelID?: string
  automation?: boolean
}): ClaraSession {
  const directory = input.directory ?? '/work/workspace'
  return {
    id: input.id,
    ...(input.harnessID ? { harnessID: input.harnessID } : {}),
    ...(input.workspaceID ? { workspaceID: input.workspaceID } : {}),
    projectID: 'project_1',
    model: { id: input.modelID ?? `model-${input.id}`, providerID: 'provider' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: input.updated },
    ...(input.automation ? { metadata: { automation: true } } : {}),
    location: { directory },
  }
}

describe('latestSessionInWorkspace', () => {
  it('chooses the newest session in the target workspace, not the list order', () => {
    const workspace = makeWorkspace({ id: 'workspace' })
    const sessions = [
      makeSession({ id: 'newer', updated: 30, workspaceID: workspace.id }),
      makeSession({ id: 'older', updated: 10, workspaceID: workspace.id }),
    ]

    expect(latestSessionInWorkspace(sessions, workspace)?.id).toBe('newer')
  })

  it('ignores a newer session from another harness', () => {
    const workspace = makeWorkspace({ id: 'workspace', harnessID: 'harness_a' })
    const sessions = [
      makeSession({
        id: 'other-harness',
        updated: 30,
        harnessID: 'harness_b',
        workspaceID: workspace.id,
        directory: workspace.directory,
      }),
      makeSession({
        id: 'saved',
        updated: 10,
        harnessID: workspace.harnessID,
        workspaceID: workspace.id,
      }),
    ]

    expect(latestSessionInWorkspace(sessions, workspace)?.id).toBe('saved')
  })

  it('ignores a newer session from another workspace on the same harness', () => {
    const workspace = makeWorkspace({ id: 'workspace' })
    const sessions = [
      makeSession({
        id: 'other-workspace',
        updated: 30,
        harnessID: workspace.harnessID,
        workspaceID: 'workspace_other',
        directory: workspace.directory,
      }),
      makeSession({
        id: 'saved',
        updated: 10,
        harnessID: workspace.harnessID,
        workspaceID: workspace.id,
      }),
    ]

    expect(latestSessionInWorkspace(sessions, workspace)?.id).toBe('saved')
  })

  it('falls back to the directory when the session has no workspace ID', () => {
    const workspace = makeWorkspace({ id: 'workspace', canonical: '/work/canonical' })
    const sessions = [
      makeSession({ id: 'canonical-match', updated: 10, directory: '/work/canonical' }),
      makeSession({ id: 'elsewhere', updated: 30, directory: '/work/elsewhere' }),
    ]

    expect(latestSessionInWorkspace(sessions, workspace)?.id).toBe('canonical-match')
  })

  it('treats a present workspace ID as authoritative', () => {
    const workspace = makeWorkspace({ id: 'workspace' })
    const sessions = [
      makeSession({
        id: 'other-workspace',
        updated: 30,
        workspaceID: 'workspace_other',
        directory: workspace.directory,
      }),
    ]

    expect(latestSessionInWorkspace(sessions, workspace)).toBeUndefined()
  })

  it('returns undefined when the workspace has no saved session', () => {
    const workspace = makeWorkspace({ id: 'workspace' })
    const sessions = [
      makeSession({
        id: 'other-workspace',
        updated: 30,
        harnessID: workspace.harnessID,
        workspaceID: 'workspace_other',
      }),
    ]

    expect(latestSessionInWorkspace(sessions, workspace)).toBeUndefined()
    expect(latestSessionInWorkspace(sessions, null)).toBeUndefined()
  })

  it('skips excluded automation sessions', () => {
    const workspace = makeWorkspace({ id: 'workspace' })
    const sessions = [
      makeSession({
        id: 'worker',
        updated: 30,
        workspaceID: workspace.id,
        automation: true,
      }),
      makeSession({ id: 'saved', updated: 10, workspaceID: workspace.id }),
    ]

    expect(
      latestSessionInWorkspace(sessions, workspace, {
        exclude: (session) => session.metadata?.automation === true,
      })?.id
    ).toBe('saved')
  })
})
