import { Component, type ErrorInfo, type ReactNode } from 'react'
import { errorMessage, errorStack } from '@/lib/errors'
import { ErrorScreen } from './error-screen'

type AppErrorBoundaryProps = {
  children: ReactNode
}

type AppErrorBoundaryState = {
  error: unknown
  hasError: boolean
}

/** Catches crashes above the router, where no route error element exists. */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error, hasError: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Unhandled Clara error', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <ErrorScreen
        detail={errorMessage(this.state.error)}
        stack={errorStack(this.state.error)}
        route={window.location.pathname + window.location.search}
      />
    )
  }
}
