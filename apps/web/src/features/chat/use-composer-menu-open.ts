import { useEffect, useState, type RefObject } from 'react'

/** A select trigger, or a menu trigger, whose content Radix portals externally. */
const OPEN_MENU_SELECTOR =
  '[aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"]'

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

  useEffect(() => {
    const section = sectionRef.current
    if (!enabled || !section) {
      setOpen(false)
      return
    }

    const sync = () => setOpen(section.querySelector(OPEN_MENU_SELECTOR) !== null)
    sync()

    // The trigger flips aria-expanded when its portal opens or closes. Watching
    // child changes also catches a trigger that unmounts with its menu open,
    // which happens when the composer switches to another session.
    const observer = new MutationObserver(sync)
    observer.observe(section, {
      attributes: true,
      attributeFilter: ['aria-expanded'],
      childList: true,
      subtree: true,
    })
    return () => observer.disconnect()
  }, [enabled, sectionRef])

  return open
}
