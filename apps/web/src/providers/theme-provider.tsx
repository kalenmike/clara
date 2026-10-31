import type { ReactNode } from 'react'
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'

// next-themes does not declare @types/react as a peer, so in this pnpm
// workspace its ThemeProviderProps cannot resolve React and loses `children`.
type Props = ThemeProviderProps & { children: ReactNode }

export function ThemeProvider({ children, ...props }: Props) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
