import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { RouterProvider } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ConnectionProvider } from '@/providers/connection-provider'
import { EventProvider } from '@/providers/event-provider'
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
      storageKey="clara.theme"
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider>
          <EventProvider>
            <TooltipProvider delayDuration={300}>
              <RouterProvider router={router} />
              <Toaster position="bottom-right" richColors closeButton />
            </TooltipProvider>
          </EventProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
