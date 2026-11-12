import { useEffect, useState } from 'react'
import { getState, streamURL } from './api'
import type { CallRecord, LabSnapshot, OrcEvent, StreamItem } from './types'

export interface LabStream {
  snapshot: LabSnapshot | null
  calls: CallRecord[]
  events: OrcEvent[]
  eventRevision: number
  previewRevision: number
  error: string | null
}

const MAX_CALLS = 600
const MAX_EVENTS = 2_000

export function useLabStream(): LabStream {
  const [snapshot, setSnapshot] = useState<LabSnapshot | null>(null)
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [events, setEvents] = useState<OrcEvent[]>([])
  const [eventRevision, setEventRevision] = useState(0)
  const [previewRevision, setPreviewRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void getState()
      .then((state) => {
        if (!alive) return
        setSnapshot(state)
        setCalls(state.calls)
        setEvents(state.events)
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })

    const source = new EventSource(streamURL())

    source.addEventListener('snapshot', (event) => {
      const item = JSON.parse((event as MessageEvent<string>).data) as StreamItem<LabSnapshot>
      if (!alive) return
      setSnapshot(item.data)
      setCalls(item.data.calls)
      setEvents(item.data.events)
      setError(null)
    })

    source.addEventListener('state', (event) => {
      const item = JSON.parse((event as MessageEvent<string>).data) as StreamItem<
        Partial<LabSnapshot>
      >
      if (!alive) return
      setSnapshot((current) => (current ? { ...current, ...item.data } : current))
    })

    source.addEventListener('call', (event) => {
      const item = JSON.parse((event as MessageEvent<string>).data) as StreamItem<CallRecord>
      if (!alive) return
      setCalls((current) => {
        if (current.some((call) => call.id === item.data.id)) return current
        return [...current, item.data].slice(-MAX_CALLS)
      })
    })

    source.addEventListener('event', (event) => {
      const item = JSON.parse((event as MessageEvent<string>).data) as StreamItem<OrcEvent>
      if (!alive) return
      setEvents((current) => {
        if (current.some((entry) => entry.id === item.data.id)) return current
        return [...current, item.data].slice(-MAX_EVENTS)
      })
      setEventRevision((value) => value + 1)
    })

    source.addEventListener('preview', () => {
      if (alive) setPreviewRevision((value) => value + 1)
    })

    source.onopen = () => {
      if (alive) {
        setError(null)
      }
    }
    source.onerror = () => {
      if (alive) {
        setError('The lab event stream is disconnected. Reconnecting…')
      }
    }

    return () => {
      alive = false
      source.close()
    }
  }, [])

  return {
    snapshot,
    calls,
    events,
    eventRevision,
    previewRevision,
    error,
  }
}
