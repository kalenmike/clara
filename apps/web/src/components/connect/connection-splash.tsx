import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ConnectionSplash({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-full flex-col items-center justify-center gap-4 bg-background px-6 py-10 text-foreground',
        className
      )}
    >
      <img src="/clara-mark.png" alt="" className="size-14 shrink-0" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  )
}
