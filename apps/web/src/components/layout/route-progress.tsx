import { useNavigation } from 'react-router'

/**
 * A lazy route chunk is fetched the first time a screen is opened, and the
 * router keeps the previous screen up until the module arrives. Without a cue
 * that wait looks like a dead click on a slow connection, so show a quiet bar
 * while a navigation is pending.
 */
export function RouteProgress() {
  const navigation = useNavigation()

  if (navigation.state === 'idle') return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden"
    >
      <div className="h-full w-full animate-pulse bg-primary/60" />
    </div>
  )
}
