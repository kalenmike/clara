import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  clampComposerHeight,
  composerHeightMax,
  COMPOSER_HEIGHT_DEFAULT,
  COMPOSER_HEIGHT_MIN,
  readComposerHeight,
  saveComposerHeight,
} from '@/lib/storage'

const STEP = 16
const LARGE_STEP = 64

type DragState = {
  pointerId: number
  startY: number
  startHeight: number
}

/**
 * Height of the pinned composer. The drag handle sits on its top edge, so
 * moving up grows the dock and moving down shrinks it.
 */
export function useComposerHeight() {
  const [height, setHeight] = useState(readComposerHeight)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<DragState | null>(null)
  const heightRef = useRef(height)

  const maxHeight = useCallback(() => composerHeightMax(window.innerHeight), [])

  const applyHeight = useCallback((next: number, persist: boolean) => {
    const clamped = clampComposerHeight(next, window.innerHeight)
    heightRef.current = clamped
    setHeight(clamped)
    if (persist) saveComposerHeight(clamped)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [dragging])

  useEffect(() => {
    const onResize = () => applyHeight(heightRef.current, false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [applyHeight])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: heightRef.current,
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    applyHeight(state.startHeight + (state.startY - event.clientY), false)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    saveComposerHeight(heightRef.current)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? LARGE_STEP : STEP
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      applyHeight(heightRef.current + step, true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      applyHeight(heightRef.current - step, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      applyHeight(COMPOSER_HEIGHT_MIN, true)
    } else if (event.key === 'End') {
      event.preventDefault()
      applyHeight(maxHeight(), true)
    }
  }

  return {
    height,
    maxHeight: maxHeight(),
    dragging,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
      onDoubleClick: () => applyHeight(COMPOSER_HEIGHT_DEFAULT, true),
    },
  }
}
