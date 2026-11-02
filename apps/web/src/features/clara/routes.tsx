import { lazy, Suspense } from 'react'
import type { RouteObject } from 'react-router'

const ClaraPage = lazy(() =>
  import('./page.tsx').then((module) => ({ default: module.ClaraPage }))
)

/** The Clara inbox route. Included only when the build flag allows it. */
export const claraRoutes: RouteObject[] = [
  {
    path: 'clara',
    element: (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            Loading Clara inbox…
          </div>
        }
      >
        <ClaraPage />
      </Suspense>
    ),
  },
]
