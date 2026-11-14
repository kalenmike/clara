import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelSessionsResponse } from '@clara/shared-types'
import { getPanel } from './panel-api.ts'

const POLL_MS = 5_000

export type PanelSessionsState = {
  data?: PanelSessionsResponse
  error?: string
  loading: boolean
  refreshing: boolean
}

export type UsePanelSessionsOptions = {
  enabled: boolean
  harnessID?: string
  runningOnly: boolean
  includeArchived: boolean
  limit?: number
}

export function usePanelSessions({
  enabled,
  harnessID,
  runningOnly,
  includeArchived,
  limit,
}: UsePanelSessionsOptions): PanelSessionsState & { refresh: () => void } {
  const [state, setState] = useState<PanelSessionsState>({ loading: true, refreshing: false })
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
      const params = new URLSearchParams()
      if (harnessID) params.set('harnessID', harnessID)
      if (runningOnly) params.set('running', 'true')
      if (includeArchived) params.set('archived', 'true')
      if (limit !== undefined) params.set('limit', String(limit))
      const search = params.toString()
      const data = await getPanel<PanelSessionsResponse>(
        `/panel/api/v1/sessions${search ? `?${search}` : ''}`
      )
      if (!mounted.current || controller.signal.aborted) return
      setState({ data, loading: false, refreshing: false })
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return
      setState((previous) => ({
        ...previous,
        loading: false,
        refreshing: false,
        error: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }, [enabled, harnessID, runningOnly, includeArchived, limit])

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
