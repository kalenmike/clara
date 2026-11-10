import { useCallback, useEffect, useRef, useState } from 'react'
import { PANEL_API_VERSION, type PanelSnapshot } from '@clara/shared-types'
import { PanelApiError } from './panel-api.ts'

const POLL_MS = 5_000

export type SnapshotState = {
  data?: PanelSnapshot
  error?: string
  loading: boolean
  refreshing: boolean
  updatedAt?: number
  now?: number
}

export type UseAgentSnapshotOptions = {
  enabled: boolean
  onUnauthorized: () => void
}

export function useAgentSnapshot({
  enabled,
  onUnauthorized,
}: UseAgentSnapshotOptions): SnapshotState & { refresh: () => void } {
  const [state, setState] = useState<SnapshotState>({ loading: true, refreshing: false })
  const inFlight = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    if (!enabled) return
    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    setState((previous) => ({
      ...previous,
      refreshing: previous.data !== undefined,
      error: undefined,
    }))

    try {
      const response = await fetch('/panel/api/v1/status', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (response.status === 401) {
        onUnauthorized()
        return
      }
      if (!response.ok) {
        throw new Error(await errorMessage(response))
      }

      const data = (await response.json()) as PanelSnapshot
      if (data.apiVersion !== PANEL_API_VERSION) {
        throw new Error(`The panel UI and agent API versions do not match (${data.apiVersion}).`)
      }
      if (!mounted.current || controller.signal.aborted) return

      const receivedAt = Date.now()
      setState({
        data,
        loading: false,
        refreshing: false,
        updatedAt: receivedAt,
        now: receivedAt,
      })
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return
      if (cause instanceof PanelApiError && cause.status === 401) {
        onUnauthorized()
        return
      }
      setState((previous) => ({
        ...previous,
        loading: false,
        refreshing: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }, [enabled, onUnauthorized])

  useEffect(() => {
    mounted.current = true
    if (!enabled) {
      setState({ loading: true, refreshing: false })
      return () => {
        mounted.current = false
        inFlight.current?.abort()
      }
    }
    void load()

    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, POLL_MS)
    const onVisibility = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mounted.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      inFlight.current?.abort()
    }
  }, [enabled, load])

  return {
    ...state,
    refresh: () => {
      void load()
    },
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') return body.error.message
  } catch {
    // Fall through to the status.
  }
  return `The panel request failed (${response.status}).`
}
