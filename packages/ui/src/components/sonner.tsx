import type { KeyboardEvent, MouseEvent } from 'react'
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner'
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react'

const toastSelector = '[data-sonner-toast]'
const toasterSelector = '[data-sonner-toaster]'
const interactiveSelector = 'button, a, input, select, textarea, [data-button]'

/*
 * Sonner mounts toasts newest first, while `toast.getToasts()` lists them
 * oldest first, so a node resolves to its toast by counting back from the end.
 * Exiting toasts are skipped: they keep a node while the leave animation runs
 * but are already gone from `getToasts()`. The mapping assumes every toast
 * belongs to this one toaster, which it does.
 */
const findToast = (target: Element) => {
  const element = target.closest<HTMLElement>(toastSelector)
  const list = element?.closest(toasterSelector)
  if (!element || !list || element.dataset.dismissible === 'false') return undefined
  const onScreen = Array.from(list.querySelectorAll<HTMLElement>(toastSelector)).filter(
    (node) => node.dataset.removed !== 'true'
  )
  const active = toast.getToasts()
  return active[active.length - 1 - onScreen.indexOf(element)]
}

const Toaster = ({ theme = 'system', ...props }: ToasterProps) => {
  /*
   * Toasts carry no close control: clicking or tapping the notification itself
   * dismisses it, and so does Enter or Space on a focused toast, so the surface
   * stays quiet without losing the keyboard path the button used to provide.
   */
  const dismissToast = (target: Element) => {
    const clicked = findToast(target)
    if (clicked) toast.dismiss(clicked.id)
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element
    if (target.closest(interactiveSelector)) return
    dismissToast(target)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (target.closest(interactiveSelector)) return
    event.preventDefault()
    dismissToast(target)
  }

  return (
    <div onClick={handleClick} onKeyDown={handleKeyDown}>
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
            '--border-radius': 'var(--radius)',
            fontFamily: 'var(--font-sans)',
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: 'cn-toast',
          },
        }}
        {...props}
      />
    </div>
  )
}

export { Toaster }
