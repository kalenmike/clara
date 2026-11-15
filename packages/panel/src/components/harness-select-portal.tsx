import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { SelectContent } from '@clara/ui/components/select'

/**
 * The element a select menu should mount into. A native `<dialog>` opened with
 * `showModal()` lives in the browser's top layer, so a menu portaled to
 * `document.body` is painted behind it regardless of its z-index. Mounting the
 * menu inside the dialog keeps it above the dialog content.
 */
const HarnessSelectPortalContext = createContext<HTMLElement | null>(null)

export function HarnessSelectPortalProvider({
  container,
  children,
}: {
  container: HTMLElement | null
  children: ReactNode
}) {
  return (
    <HarnessSelectPortalContext.Provider value={container}>
      {children}
    </HarnessSelectPortalContext.Provider>
  )
}

/** A select menu that stays above the harness pairing dialog. */
export function HarnessSelectContent({
  position = 'popper',
  align = 'start',
  ...props
}: Omit<ComponentProps<typeof SelectContent>, 'container'>) {
  const container = useContext(HarnessSelectPortalContext)
  return (
    <SelectContent
      {...props}
      position={position}
      align={align}
      container={container ?? undefined}
    />
  )
}
