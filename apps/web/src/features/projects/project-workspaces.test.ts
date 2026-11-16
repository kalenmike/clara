import { describe, expect, it } from 'vitest'
import type { ClaraProject, ClaraProjectWorkspace } from '@clara/api-contract'
import {
  isWorkspaceStartable,
  projectSessionWorkspaces,
  projectSpansHarnesses,
  resolveProjectWorkspaceTarget,
  workspaceHarnessLabels,
} from './project-workspaces'

function makeWorkspace(input: {
  id: string
  harnessID: string
  harnessLabel?: string
  online?: boolean
  linked?: boolean
  label?: string
  directory?: string
  harnessHost?: ClaraProjectWorkspace['harnessHost']
}): ClaraProjectWorkspace {
  const directory = input.directory ?? `/work/${input.id}`
  return {
    id: input.id,
    harnessID: input.harnessID,
    harnessKind: 'test',
    harnessLabel: input.harnessLabel ?? input.harnessID,
    ...(input.harnessHost ? { harnessHost: input.harnessHost } : {}),
    online: input.online ?? true,
    active: false,
    directory,
    canonical: directory,
    ...(input.label ? { label: input.label } : {}),
    projectIDs: [`harness-project-${input.id}`],
    linked: input.linked ?? true,
  }
}

function makeProject(
  workspaces: ClaraProjectWorkspace[],
  defaultWorkspaceID?: string
): ClaraProject {
  return {
    id: 'proj_1',
    time: { created: 0, updated: 0, active: 0 },
    ...(defaultWorkspaceID ? { defaultWorkspaceID } : {}),
    workspaces,
  }
}

describe('projectSessionWorkspaces', () => {
  it('keeps linked workspaces across harnesses and drops unlinked ones', () => {
    const linkedOffline = makeWorkspace({ id: 'offline', harnessID: 'harness_b', online: false })
    const unlinked = makeWorkspace({ id: 'unlinked', harnessID: 'harness_c', linked: false })
    const linkedOnline = makeWorkspace({ id: 'online', harnessID: 'harness_a' })

    expect(
      projectSessionWorkspaces(makeProject([linkedOffline, unlinked, linkedOnline])).map(
        (workspace) => workspace.id
      )
    ).toEqual(['offline', 'online'])
  })
})

describe('resolveProjectWorkspaceTarget', () => {
  it('prefers the workspace last used for the project', () => {
    const first = makeWorkspace({ id: 'first', harnessID: 'harness_a' })
    const second = makeWorkspace({ id: 'second', harnessID: 'harness_a' })
    const project = makeProject([first, second], first.id)

    const target = resolveProjectWorkspaceTarget(project, second.id)

    expect(target.workspace?.id).toBe('second')
    expect(target.startable).toBe(true)
  })

  it('uses the project default when it is online', () => {
    const first = makeWorkspace({ id: 'first', harnessID: 'harness_a' })
    const preferred = makeWorkspace({ id: 'preferred', harnessID: 'harness_a' })
    const project = makeProject([first, preferred], preferred.id)

    expect(resolveProjectWorkspaceTarget(project, null).workspace?.id).toBe('preferred')
  })

  it('falls back to the first online workspace when the default is offline', () => {
    const offline = makeWorkspace({ id: 'offline', harnessID: 'harness_a', online: false })
    const online = makeWorkspace({ id: 'online', harnessID: 'harness_a' })
    const project = makeProject([offline, online], offline.id)

    const target = resolveProjectWorkspaceTarget(project, null)

    expect(target.workspace?.id).toBe('online')
    expect(target.startable).toBe(true)
  })

  it('returns the first linked workspace but marks it unstartable when all are offline', () => {
    const first = makeWorkspace({ id: 'first', harnessID: 'harness_a', online: false })
    const second = makeWorkspace({ id: 'second', harnessID: 'harness_b', online: false })
    const project = makeProject([first, second], second.id)

    const target = resolveProjectWorkspaceTarget(project, null)

    expect(target.workspace?.id).toBe('first')
    expect(target.startable).toBe(false)
    expect(isWorkspaceStartable(first)).toBe(false)
  })

  it('selects a workspace on the requested harness without crossing harnesses', () => {
    const harnessA = makeWorkspace({ id: 'a', harnessID: 'harness_a' })
    const harnessB = makeWorkspace({ id: 'b', harnessID: 'harness_b' })
    const project = makeProject([harnessA, harnessB], harnessA.id)

    expect(resolveProjectWorkspaceTarget(project, harnessB.id).workspace?.id).toBe('b')

    const moved = resolveProjectWorkspaceTarget(project, harnessB.id, { harnessID: 'harness_a' })
    expect(moved.workspace?.id).toBe('a')
    expect(moved.workspace?.harnessID).toBe('harness_a')
  })

  it('returns no target when the requested harness has no linked workspace', () => {
    const project = makeProject([makeWorkspace({ id: 'a', harnessID: 'harness_a' })], 'a')

    const target = resolveProjectWorkspaceTarget(project, null, { harnessID: 'harness_missing' })

    expect(target.workspace).toBeNull()
    expect(target.startable).toBe(false)
  })
})

describe('project helpers', () => {
  it('detects projects that span harnesses', () => {
    const single = makeProject([
      makeWorkspace({ id: 'a', harnessID: 'harness_a' }),
      makeWorkspace({ id: 'b', harnessID: 'harness_a' }),
    ])
    const mixed = makeProject([
      makeWorkspace({ id: 'a', harnessID: 'harness_a' }),
      makeWorkspace({ id: 'b', harnessID: 'harness_b' }),
    ])

    expect(projectSpansHarnesses(single)).toBe(false)
    expect(projectSpansHarnesses(mixed)).toBe(true)
  })

  it('adds a short harness id only when labels collide across harnesses', () => {
    const workspaces = [
      makeWorkspace({ id: 'a1', harnessID: 'harness-aaa111', harnessLabel: 'OpenCode' }),
      makeWorkspace({ id: 'a2', harnessID: 'harness-aaa111', harnessLabel: 'OpenCode' }),
      makeWorkspace({ id: 'b1', harnessID: 'harness-bbb222', harnessLabel: 'OpenCode' }),
      makeWorkspace({ id: 'c1', harnessID: 'harness-ccc333', harnessLabel: 'Claude' }),
    ]

    const labels = workspaceHarnessLabels(workspaces)

    expect(labels.get('a1')).toBe('OpenCode (aaa111)')
    expect(labels.get('a2')).toBe('OpenCode (aaa111)')
    expect(labels.get('b1')).toBe('OpenCode (bbb222)')
    expect(labels.get('c1')).toBe('Claude')
  })

  it('uses the reported host to tell identical harness labels apart', () => {
    const workspaces = [
      makeWorkspace({
        id: 'local',
        harnessID: 'harness-aaa111',
        harnessLabel: 'OpenCode',
        harnessHost: { hostname: 'build-box', installMethod: 'local' },
      }),
      makeWorkspace({
        id: 'remote',
        harnessID: 'harness-bbb222',
        harnessLabel: 'OpenCode',
        harnessHost: { hostname: 'prod', installMethod: 'ssh' },
      }),
    ]

    const labels = workspaceHarnessLabels(workspaces)

    expect(labels.get('local')).toBe('OpenCode · build-box')
    expect(labels.get('remote')).toBe('OpenCode · prod · SSH')
  })
})
