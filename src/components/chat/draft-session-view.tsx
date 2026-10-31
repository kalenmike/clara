import { SquarePen } from 'lucide-react'

export function DraftSessionView({ hasDraft }: { hasDraft: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border bg-card">
        <SquarePen className="size-5 text-muted-foreground" />
      </div>
      <div className="max-w-sm">
        <p className="text-sm font-medium">{hasDraft ? 'Draft in progress' : 'New message'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {hasDraft
            ? 'Your text is saved in this browser. Press New to reopen the composer and keep writing.'
            : 'Press New to write the first message. Use / for commands or @ to reference files and agents.'}
        </p>
      </div>
    </div>
  )
}
