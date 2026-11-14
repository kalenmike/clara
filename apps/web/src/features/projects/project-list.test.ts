import { describe, expect, it } from 'vitest'
import type { ClaraProject } from '@clara/api-contract'
import {
  filterVisibleProjects,
  projectLabel,
  projectRecency,
  recentProjects,
  sortProjectsByRecency,
} from './project-list'

function makeProject(input: {
  id: string
  canonical: string
  active: number
  updated?: number
  name?: string
}): ClaraProject {
  return {
    id: input.id,
    name: input.name,
    time: {
      created: input.active,
      updated: input.updated ?? input.active,
      active: input.active,
    },
    defaultWorkspaceID: 'workspace-1',
    workspaces: [
      {
        id: 'workspace-1',
        harnessID: 'harness-1',
        harnessKind: 'test',
        harnessLabel: 'Test harness',
        online: true,
        active: true,
        directory: input.canonical,
        canonical: input.canonical,
        projectIDs: ['harness-project-1'],
        linked: true,
      },
    ],
  }
}

describe('projectLabel', () => {
  it('prefers a server name and falls back to the directory basename', () => {
    expect(projectLabel(makeProject({ id: '1', canonical: '/home/jet/clara', active: 1 }))).toBe(
      'clara'
    )
    expect(
      projectLabel(makeProject({ id: '1', canonical: '/home/jet/clara', active: 1, name: 'Work' }))
    ).toBe('Work')
    expect(projectLabel(makeProject({ id: 'root', canonical: '/', active: 1 }))).toBe(
      'Untitled project'
    )
  })
})

describe('projectRecency', () => {
  it('uses active, then updated, then created', () => {
    const project = makeProject({ id: '1', canonical: '/a', active: 10 })
    expect(projectRecency(project)).toBe(10)
    expect(projectRecency({ ...project, time: { ...project.time, active: 0, updated: 8 } })).toBe(8)
    expect(projectRecency({ ...project, time: { created: 3, updated: 0, active: 0 } })).toBe(3)
  })
})

describe('sortProjectsByRecency', () => {
  it('puts the newest activity first and does not mutate the input', () => {
    const older = makeProject({ id: 'older', canonical: '/older', active: 5 })
    const newer = makeProject({ id: 'newer', canonical: '/newer', active: 10 })
    const projects = [older, newer]
    expect(sortProjectsByRecency(projects).map((project) => project.id)).toEqual(['newer', 'older'])
    expect(projects.map((project) => project.id)).toEqual(['older', 'newer'])
  })
})

describe('filterVisibleProjects', () => {
  const projects = [
    makeProject({ id: 'active', canonical: '/active', active: 2 }),
    makeProject({ id: 'empty', canonical: '/empty', active: 1 }),
    makeProject({ id: 'unknown', canonical: '/unknown', active: 3 }),
  ]

  it('keeps every project when empty projects are shown', () => {
    expect(filterVisibleProjects(projects, new Map([['empty', false]]), true)).toEqual(projects)
  })

  it('hides projects known to have no sessions', () => {
    const hasSessions = new Map([
      ['active', true],
      ['empty', false],
      ['unknown', true],
    ])
    expect(
      filterVisibleProjects(projects, hasSessions, false).map((project) => project.id)
    ).toEqual(['active', 'unknown'])
  })

  it('keeps projects whose session lookup is unknown', () => {
    expect(filterVisibleProjects(projects, new Map([['empty', false]]), false)).toEqual([
      projects[0],
      projects[2],
    ])
  })

  it('keeps projects with an incomplete harness answer when counts look empty', () => {
    const hasSessions = new Map([
      ['active', false],
      ['empty', false],
    ])
    expect(
      filterVisibleProjects(projects, hasSessions, false, new Set(['active'])).map(
        (project) => project.id
      )
    ).toEqual(['active', 'unknown'])
  })
})

describe('recentProjects', () => {
  const projects = Array.from({ length: 10 }, (_, index) =>
    makeProject({
      id: `project-${index + 1}`,
      canonical: `/project-${index + 1}`,
      active: 100 - index,
    })
  )

  it('caps the list at seven', () => {
    expect(recentProjects(projects).map((project) => project.id)).toEqual([
      'project-1',
      'project-2',
      'project-3',
      'project-4',
      'project-5',
      'project-6',
      'project-7',
    ])
  })

  it('pins an out-of-window selected project at the end', () => {
    expect(recentProjects(projects, 'project-9').map((project) => project.id)).toEqual([
      'project-1',
      'project-2',
      'project-3',
      'project-4',
      'project-5',
      'project-6',
      'project-9',
    ])
  })

  it('leaves the list alone when the selected project is already recent', () => {
    expect(recentProjects(projects, 'project-3').map((project) => project.id)).toEqual([
      'project-1',
      'project-2',
      'project-3',
      'project-4',
      'project-5',
      'project-6',
      'project-7',
    ])
  })
})
