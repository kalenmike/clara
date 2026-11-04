import { isRouteErrorResponse, useRouteError } from 'react-router'
import { errorMessage, errorStack } from '@/lib/errors'
import { ErrorScreen } from './error-screen'

/** Replaces React Router's built-in crash screen for every route. */
export function RouteError() {
  const error = useRouteError()

  return (
    <ErrorScreen
      detail={routeErrorDetail(error)}
      stack={errorStack(error)}
      route={window.location.pathname + window.location.search}
    />
  )
}

function routeErrorDetail(error: unknown): string {
  if (!isRouteErrorResponse(error)) return errorMessage(error)

  const status = `${error.status} ${error.statusText}`.trim()
  const data = typeof error.data === 'string' && error.data.trim() ? `\n${error.data.trim()}` : ''

  return status ? `${status}${data}` : 'Route error'
}
