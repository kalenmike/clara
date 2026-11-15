import { describe, expect, it } from 'vitest'
import { composerReturnPath, composerSessionTitle, routeComposerTarget } from './composer-session'

const A = { sessionID: 'session-a', projectID: 'project-1' }

describe('routeComposerTarget', () => {
  it('builds a target only for a session route', () => {
    expect(routeComposerTarget('project-1', 'session-a')).toEqual(A)
    expect(routeComposerTarget('project-1', undefined)).toBeNull()
  })
})

describe('composer paths', () => {
  it('builds a return path from the stored project and session', () => {
    expect(composerReturnPath(A)).toBe('/p/project-1/s/session-a')
    expect(composerReturnPath({ sessionID: 'session-a' })).toBeNull()
  })
})

describe('composer header', () => {
  it('uses the session title, falling back to the configured noun', () => {
    expect(composerSessionTitle('Fix the composer', 'brief')).toBe('Fix the composer')
    expect(composerSessionTitle('  ', 'task')).toBe('Untitled task')
  })
})
