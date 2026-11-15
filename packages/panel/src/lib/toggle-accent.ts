import type { ToggleState } from '../components/primitives.tsx'

const TOGGLE_TRACKS: Record<ToggleState, string> = {
  off: 'border-border bg-muted',
  pending: 'border-amber-500 bg-amber-500',
  on: 'border-emerald-600 bg-emerald-600',
}

const STOPPED_ON_TRACK = 'border-red-600 bg-red-600'

/**
 * Track classes for a switch.
 *
 * An enabled switch is green while connections are on and red while they are off.
 * The off and pending tracks keep their existing appearance in both cases, and
 * the result depends only on the arguments so the caller's toggle state is
 * never rewritten.
 */
export function toggleTrackClasses(state: ToggleState, stopped: boolean): string {
  if (state === 'on' && stopped) return STOPPED_ON_TRACK
  return TOGGLE_TRACKS[state]
}
