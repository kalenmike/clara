import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

type PageShellProps = {
  title: string
  description?: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function PageShell({ title, description, eyebrow, actions, children }: PageShellProps) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <header>
          <Link
            to="/"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to home
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {eyebrow}
                </div>
              )}
              <h1 className={cn('text-xl font-semibold tracking-tight', eyebrow && 'mt-1')}>
                {title}
              </h1>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions}
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
