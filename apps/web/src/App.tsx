import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/sonner'
import { TooltipProvider } from '@clara/ui/components/tooltip'
import { AdapterLinkWatcher } from '@/features/harness/adapter-link-watcher'
import { ConnectionProvider } from '@/providers/connection-provider'
import { EventProvider } from '@/providers/event-provider'
import { ThemeProvider } from '@/providers/theme-provider'
import { THEME_KEY } from '@/lib/storage'
import { router } from '@/router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      storageKey={THEME_KEY}
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider>
          <EventProvider>
            <TooltipProvider delayDuration={300}>
              <RouterProvider router={router} />
              <AdapterLinkWatcher />
              <Toaster position="top-right" />
            </TooltipProvider>
          </EventProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
