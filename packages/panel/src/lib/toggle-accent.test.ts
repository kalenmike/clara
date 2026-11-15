/**
 * Contract for `./toggle-accent.ts`.
 *
 * The feature-switch accent rule must be a pure function
 * `toggleTrackClasses(state, stopped)` returning the Tailwind track classes for
 * a switch:
 *
 * - `stopped = false` reproduces today's appearance: an enabled (`on`) switch
 *   is green.
 * - `stopped = true` renders the enabled (`on`) switch red, while `off` keeps
 *   the existing neutral/disabled track in both cases.
 * - It depends only on its arguments: no latch on the stopped flag, no
 *   mutation of the caller's toggle state.
 *
 * Criteria 4–8 in the record are human gates; they have no automated test.
 */
import { describe, expect, it } from 'vitest'
import { toggleTrackClasses } from './toggle-accent.ts'

const GREEN = /bg-emerald-\d{3}/
const RED = /bg-red-\d{3}/
const NEUTRAL = /bg-muted/

describe('feature switch accent rule', () => {
  it('criterion 1: while connections are on, the toggle accent rule yields the green enabled accent for an enabled toggle and leaves a disabled toggle on the existing disabled accent', () => {
    const enabledRunning = toggleTrackClasses('on', false)
    expect(enabledRunning).toMatch(GREEN)
    expect(enabledRunning).not.toMatch(RED)

    const disabledRunning = toggleTrackClasses('off', false)
    expect(disabledRunning).toMatch(NEUTRAL)
    expect(disabledRunning).not.toMatch(GREEN)
    expect(disabledRunning).not.toMatch(RED)
  })

  it('criterion 2: while connections are off, the same toggle accent rule yields the red stopped accent for an enabled toggle and leaves a disabled toggle on the existing disabled accent', () => {
    const enabledStopped = toggleTrackClasses('on', true)
    expect(enabledStopped).toMatch(RED)
    expect(enabledStopped).not.toMatch(GREEN)

    const disabledStopped = toggleTrackClasses('off', true)
    expect(disabledStopped).toMatch(NEUTRAL)
    expect(disabledStopped).not.toMatch(RED)
    expect(disabledStopped).not.toMatch(GREEN)
    expect(disabledStopped).toBe(toggleTrackClasses('off', false))
  })

  it('criterion 3: crossing the stop/start boundary changes only the accent: a toggle’s enabled value is untouched, so starting again restores green on exactly the toggles that were enabled before Stop', () => {
    const features = [
      { name: 'opencode', enabled: true },
      { name: 'local', enabled: false },
      { name: 'relay', enabled: true },
      { name: 'push', enabled: false },
    ] as const

    const accentFor = (enabled: boolean, stopped: boolean): string =>
      toggleTrackClasses(enabled ? 'on' : 'off', stopped)

    const beforeStop = features.map((feature) => accentFor(feature.enabled, false))
    const whileStopped = features.map((feature) => accentFor(feature.enabled, true))

    features.forEach((feature, index) => {
      if (feature.enabled) {
        // Enabled switches are the only ones whose accent changes.
        expect(whileStopped[index]).toMatch(RED)
        expect(whileStopped[index]).not.toBe(beforeStop[index])
      } else {
        expect(whileStopped[index]).toBe(beforeStop[index])
      }
    })

    // Starting again restores the exact pre-stop accents, with no toggle clicked.
    const afterStart = features.map((feature) => accentFor(feature.enabled, false))
    expect(afterStart).toEqual(beforeStop)

    // The accent rule never rewrites the enabled value it was given.
    expect(features.map((feature) => feature.enabled)).toEqual([true, false, true, false])
  })
})
