import { describe, expect, it, vi } from 'vitest'
import type { Project } from '@opencode/client'
import type { ClaraClient } from '@/lib/client'
import { reconcileArchivedProjects } from './reconcile-projects'

function project(id: string, archived?: number): Project {
  return {
    id,
    canonical: `/work/${id}`,
    time: {
      created: 0,
      updated: 0,
      active: 0,
      ...(archived === undefined ? {} : { archived }),
    },
    sandboxes: [],
  }
}

describe('reconcileArchivedProjects', () => {
  it('does not probe when every project is already active', async () => {
    const get = vi.fn()
    const client = {
      project: { list: async () => [project('active')] },
      location: { get },
    } as unknown as ClaraClient

    const result = await reconcileArchivedProjects(client)

    expect(result).toEqual({ archived: 0, restored: [] })
    expect(get).not.toHaveBeenCalled()
  })

  it('probes archived projects and reports the ones whose directory resolved', async () => {
    const get = vi.fn(async (input: { location?: { directory?: string } }) => {
      if (input.location?.directory === '/work/gone') throw new Error('Location not found')
      return {
        directory: input.location?.directory ?? '',
        project: { id: 'back', directory: input.location?.directory ?? '', canonical: '' },
      }
    })
    const client = {
      project: {
        list: async () => [project('active'), project('back', 10), project('gone', 20)],
      },
      location: { get },
    } as unknown as ClaraClient

    const result = await reconcileArchivedProjects(client)

    expect(result).toEqual({ archived: 2, restored: ['back'] })
    expect(get).toHaveBeenCalledTimes(2)
    expect(get.mock.calls.map(([input]) => input.location?.directory)).toEqual(
      expect.arrayContaining(['/work/back', '/work/gone'])
    )
  })

  it('keeps probing after one directory fails', async () => {
    const get = vi.fn(async (input: { location?: { directory?: string } }) => {
      if (input.location?.directory === '/work/first') throw new Error('Location not found')
      return {
        directory: input.location?.directory ?? '',
        project: { id: 'second', directory: input.location?.directory ?? '', canonical: '' },
      }
    })
    const client = {
      project: { list: async () => [project('first', 10), project('second', 20)] },
      location: { get },
    } as unknown as ClaraClient

    const result = await reconcileArchivedProjects(client)

    expect(result.restored).toEqual(['second'])
    expect(get).toHaveBeenCalledTimes(2)
  })
})
