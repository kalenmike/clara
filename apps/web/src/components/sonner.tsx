import type { ComponentProps } from 'react'
import { useTheme } from 'next-themes'
import { Toaster as SharedToaster } from '@clara/ui/components/sonner'

/**
 * The shared toast surface has no theme provider of its own. The web client
 * owns the mode through next-themes, so this wrapper maps it to the one prop the
 * shared component needs.
 */
export function Toaster(props: ComponentProps<typeof SharedToaster>) {
  const { theme } = useTheme()
  const resolved = theme === 'light' || theme === 'dark' ? theme : 'system'

  return <SharedToaster theme={resolved} {...props} />
}
