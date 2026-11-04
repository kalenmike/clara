import { describe, expect, it } from 'vitest'
import {
  composerConnectionLabel,
  composerOpenTarget,
  composerReturnPath,
  composerSessionTitle,
  isComposerDetached,
  routeComposerTarget,
} from './composer-session'

const A = { sessionID: 'session-a', projectID: 'project-1' }
const B = { sessionID: 'session-b', projectID: 'project-1' }

describe('routeComposerTarget', () => {
  it('builds a target only for a session route', () => {
    expect(routeComposerTarget('project-1', 'session-a')).toEqual(A)
    expect(routeComposerTarget('project-1', undefined)).toBeNull()
  })
})

describe('composerOpenTarget', () => {
  it('binds an opening composer to the current session', () => {
    expect(composerOpenTarget({ mode: 'closed', route: B, current: A })).toEqual(B)
  })

  it('keeps the original session while the composer stays open or minimized', () => {
    expect(composerOpenTarget({ mode: 'normal', route: B, current: A })).toEqual(A)
    expect(composerOpenTarget({ mode: 'minimized', route: B, current: A })).toEqual(A)
    expect(composerOpenTarget({ mode: 'maximized', route: B, current: A })).toEqual(A)
  })

  it('lets explicit compose actions re-target an open composer', () => {
    expect(composerOpenTarget({ mode: 'normal', route: B, current: A, explicit: B })).toEqual(B)
  })
})

describe('composer detachment', () => {
  it('is detached only when the connected session is not the route session', () => {
    expect(isComposerDetached(A, 'session-b')).toBe(true)
    expect(isComposerDetached(A, 'session-a')).toBe(false)
    expect(isComposerDetached(null, undefined)).toBe(false)
  })

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

  it('labels the connection with the configured noun', () => {
    expect(composerConnectionLabel(false, 'brief')).toBe('Draft for this brief')
    expect(composerConnectionLabel(true, 'run')).toBe('Draft for another run')
  })
})
