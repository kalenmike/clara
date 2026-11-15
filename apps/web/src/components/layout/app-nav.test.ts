import { describe, expect, it } from 'vitest'
import { APP_NAV_ITEMS, isAppNavItemActive, visibleAppNavItems } from './app-nav'

const activeLabels = (pathname: string) =>
  APP_NAV_ITEMS.filter((item) => isAppNavItemActive(item, pathname)).map((item) => item.label)

describe('app navigation', () => {
  it('treats the start view, projects, and sessions as Chat', () => {
    for (const pathname of [
      '/',
      '/projects',
      '/projects/abc',
      '/p/project-1',
      '/p/project-1/s/session-1',
    ]) {
      expect(activeLabels(pathname)).toEqual(['Chat'])
    }
  })

  it('marks one section for each top-level route', () => {
    expect(activeLabels('/activity')).toEqual(['Activity'])
    expect(activeLabels('/hub')).toEqual(['Panel'])
    expect(activeLabels('/lab')).toEqual(['Lab'])
    expect(activeLabels('/settings')).toEqual(['Settings'])
  })

  it('keeps nested routes inside their section', () => {
    expect(activeLabels('/activity/session-1')).toEqual(['Activity'])
    expect(activeLabels('/hub/harness')).toEqual(['Panel'])
    expect(activeLabels('/settings/appearance')).toEqual(['Settings'])
  })

  it('does not treat a prefix of another route as Chat', () => {
    expect(activeLabels('/projector')).toEqual([])
    expect(activeLabels('/path')).toEqual([])
  })

  it('hides Lab outside the desktop shell', () => {
    expect(visibleAppNavItems(false).map((item) => item.label)).toEqual([
      'Chat',
      'Activity',
      'Panel',
      'Settings',
    ])
    expect(visibleAppNavItems(true).map((item) => item.label)).toContain('Lab')
  })
})
