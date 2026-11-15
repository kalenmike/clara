import { useEffect, useRef, useState, type RefObject } from 'react'

/** A select trigger, or a menu trigger, whose content Radix portals externally. */
const OPEN_MENU_SELECTOR =
  '[aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"]'

/**
 * Long enough for a closed popup's exit animation, which keeps its portal
 * mounted after the trigger reports that it is closed.
 */
const CLOSE_GRACE_MS = 200

/**
 * Whether a select or menu opened from the composer is showing. Radix portals
 * the content beside the composer, so the pointer resting on the popup is
 * outside the section even though the popup belongs to it.
 */
export function useComposerMenuOpen(
  sectionRef: RefObject<HTMLElement | null>,
  enabled: boolean
): boolean {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    const section = sectionRef.current
    if (!enabled || !section) {
      setOpen(false)
      return
    }

    const clearCloseTimer = () => {
      if (closeTimer.current === null) return
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    const hasOpenMenu = () => section.querySelector(OPEN_MENU_SELECTOR) !== null

    const sync = () => {
      if (hasOpenMenu()) {
        clearCloseTimer()
        setOpen(true)
        return
      }
      if (closeTimer.current !== null) return
      // Keep the dock in place while the popup animates out: it is still
      // portaled and anchored to a trigger that a resting dock would hide.
      closeTimer.current = window.setTimeout(() => {
        closeTimer.current = null
        setOpen(hasOpenMenu())
      }, CLOSE_GRACE_MS)
    }

    sync()

    // The trigger flips aria-expanded when its portal opens or closes.
    // Watching child changes also catches a trigger that unmounts with its
    // menu open, which happens when the composer switches to another session.
    const observer = new MutationObserver(sync)
    observer.observe(section, {
      attributes: true,
      attributeFilter: ['aria-expanded'],
      childList: true,
      subtree: true,
    })
    return () => {
      observer.disconnect()
      clearCloseTimer()
    }
  }, [enabled, sectionRef])

  return open
}
