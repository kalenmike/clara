import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

const STEP = 8
const LARGE_STEP = 32
const NO_RESERVED = () => 0

type ResizeEdge = 'left' | 'right'

type PanelWidthOptions = {
  /** Which side of the panel the drag handle sits on. */
  edge: ResizeEdge
  min: number
  max: number
  defaultWidth: number
  /** Space the rest of the layout needs to stay usable. */
  contentMinWidth: number
  /** Space already taken by other persistent panels. */
  reserved?: () => number
  read: () => number
  save: (width: number) => void
}

type DragState = {
  pointerId: number
  startX: number
  startWidth: number
}

export function usePanelWidth({
  edge,
  min,
  max,
  defaultWidth,
  contentMinWidth,
  reserved = NO_RESERVED,
  read,
  save,
}: PanelWidthOptions) {
  const maxWidth = useCallback(() => {
    const available = window.innerWidth - contentMinWidth - reserved()
    return Math.max(min, Math.min(max, available))
  }, [contentMinWidth, max, min, reserved])

  const clampWidth = useCallback(
    (width: number) => Math.min(maxWidth(), Math.max(min, Math.round(width))),
    [maxWidth, min]
  )

  const [width, setWidth] = useState(() => clampWidth(read()))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragState | null>(null)
  const widthRef = useRef(width)

  const applyWidth = useCallback(
    (next: number, persist: boolean) => {
      const clamped = clampWidth(next)
      widthRef.current = clamped
      setWidth(clamped)
      if (persist) save(clamped)
    },
    [clampWidth, save]
  )

  useEffect(() => {
    if (!dragging) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [dragging])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widthRef.current,
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const delta = event.clientX - state.startX
    applyWidth(edge === 'left' ? state.startWidth - delta : state.startWidth + delta, false)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    save(widthRef.current)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? LARGE_STEP : STEP
    const growKey = edge === 'left' ? 'ArrowLeft' : 'ArrowRight'
    const shrinkKey = edge === 'left' ? 'ArrowRight' : 'ArrowLeft'
    if (event.key === growKey) {
      event.preventDefault()
      applyWidth(widthRef.current + step, true)
    } else if (event.key === shrinkKey) {
      event.preventDefault()
      applyWidth(widthRef.current - step, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      applyWidth(min, true)
    } else if (event.key === 'End') {
      event.preventDefault()
      applyWidth(maxWidth(), true)
    }
  }

  const resetWidth = () => applyWidth(defaultWidth, true)

  return {
    width,
    dragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick: resetWidth,
    },
  }
}
