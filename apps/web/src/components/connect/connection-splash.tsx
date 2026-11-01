import { Loader2, Sparkles } from 'lucide-react'
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
      <div className="flex size-14 items-center justify-center rounded-2xl bg-foreground text-background">
        <Sparkles className="size-7" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  )
}
