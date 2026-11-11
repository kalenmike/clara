import { describe, expect, it } from 'vitest'
import type { ClaraProject } from '@clara/api-contract'
import { projectAvatarSource, projectInitial } from './project-avatar'

function project(overrides: Partial<ClaraProject> = {}): ClaraProject {
  return {
    id: 'project-1',
    canonical: '/home/jet/Projects/clara',
    name: 'Clara',
    vcs: 'git',
    sandboxes: [],
    time: { created: 1, updated: 2, active: 3 },
    ...overrides,
  }
}

describe('projectAvatarSource', () => {
  it('prefers the custom image over a color and the discovered favicon', () => {
    expect(
      projectAvatarSource(
        project({
          icon: {
            override: 'data:image/png;base64,override',
            color: 'pink',
            url: 'data:image/png;base64,favicon',
          },
        })
      )
    ).toEqual({ kind: 'image', src: 'data:image/png;base64,override' })
  })

  it('lets an explicit color hide the discovered favicon', () => {
    expect(
      projectAvatarSource(
        project({
          icon: {
            color: 'mint',
            url: 'data:image/png;base64,favicon',
          },
        })
      )
    ).toEqual({ kind: 'color', color: 'mint' })
  })

  it('uses the discovered favicon when there is no custom image or color', () => {
    expect(
      projectAvatarSource(project({ icon: { url: 'data:image/png;base64,favicon' } }))
    ).toEqual({ kind: 'image', src: 'data:image/png;base64,favicon' })
  })

  it('ignores unknown color keys and image sources that cannot be rendered', () => {
    expect(
      projectAvatarSource(
        project({
          icon: {
            color: 'chartreuse',
            override: 'javascript:alert(1)',
            url: 'file:///tmp/icon.png',
          },
        })
      )
    ).toEqual({ kind: 'default' })
  })

  it('treats empty strings as absent', () => {
    expect(projectAvatarSource(project({ icon: { override: '', color: '', url: '' } }))).toEqual({
      kind: 'default',
    })
  })
})

describe('projectInitial', () => {
  it('uses the first character of the project label', () => {
    expect(projectInitial(project({ name: 'clara' }))).toBe('C')
    expect(projectInitial(project({ name: undefined, canonical: '/tmp/website' }))).toBe('W')
  })
})
