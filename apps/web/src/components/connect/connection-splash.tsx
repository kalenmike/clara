import { Loader2 } from 'lucide-react'
import { AppFooter } from '@/components/pwa/app-footer'
import { cn } from '@/lib/utils'

export function ConnectionSplash({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('h-full overflow-y-auto bg-background text-foreground', className)}>
      <div className="flex min-h-full flex-col">
        <div
          role="status"
          aria-live="polite"
          className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10"
        >
          <img src="/clara-mark.png" alt="" className="size-14 shrink-0" />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {label}
          </div>
        </div>
        <AppFooter />
      </div>
    </div>
  )
}
