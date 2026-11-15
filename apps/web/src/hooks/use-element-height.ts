import { useEffect, useRef, useState } from 'react'

/**
 * Tracks the border-box height of an element. The composer measures its tab
 * strip so the collapsed shell can animate to a real pixel height instead of
 * snapping between a pinned height and `auto`.
 */
export function useElementHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const apply = (next: number) =>
      setHeight((current) => (Math.abs(current - next) < 0.5 ? current : next))

    apply(element.getBoundingClientRect().height)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      apply(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, height] as const
}
