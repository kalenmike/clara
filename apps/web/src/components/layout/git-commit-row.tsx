import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { parseConventionalHeader, splitCommitBody, type GitCommit } from '@/features/git/use-git'
import { formatCommitDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const TYPE_COLOR: Record<string, string> = {
  feat: 'text-emerald-600 dark:text-emerald-400',
  fix: 'text-rose-600 dark:text-rose-400',
  docs: 'text-sky-600 dark:text-sky-400',
  refactor: 'text-violet-600 dark:text-violet-400',
  perf: 'text-orange-600 dark:text-orange-400',
  test: 'text-amber-600 dark:text-amber-400',
  build: 'text-cyan-600 dark:text-cyan-400',
  ci: 'text-cyan-600 dark:text-cyan-400',
  chore: 'text-slate-500 dark:text-slate-400',
  style: 'text-pink-600 dark:text-pink-400',
  revert: 'text-red-600 dark:text-red-400',
}

const SCOPE_COLOR = 'text-blue-600 dark:text-blue-400'

export function GitCommitRow({ commit }: { commit: GitCommit }) {
  const [open, setOpen] = useState(false)
  const header = parseConventionalHeader(commit.subject)
  const { message, coAuthors } = splitCommitBody(commit.body)

  return (
    <li className="overflow-hidden rounded-md border bg-card/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-accent/50 max-md:py-2.5"
          >
            <ChevronRight
              className={cn(
                'mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90'
              )}
            />
            <span
              className="shrink-0 font-mono text-[10px] text-muted-foreground"
              title={commit.hash}
            >
              {commit.hash.slice(0, 7)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[10px]" title={commit.subject}>
              {header ? <ConventionalSubject header={header} /> : commit.subject}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-1.5 border-t px-2 py-2 text-[10px]">
            <Detail label="Date" value={formatCommitDate(commit.authoredAt)} />
            <Detail label="Author" value={formatPerson(commit.authorName, commit.authorEmail)} />
            {coAuthors.length > 0 && (
              <div className="flex gap-1.5">
                <span className="w-14 shrink-0 text-muted-foreground">Co-authors</span>
                <div className="min-w-0 space-y-0.5">
                  {coAuthors.map((author) => (
                    <p key={`${author.name}-${author.email}`} className="break-words">
                      {formatPerson(author.name, author.email)}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {message && (
              <div className="space-y-0.5">
                <span className="text-muted-foreground">Message</span>
                <p className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-1.5 leading-relaxed">
                  {message}
                </p>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function ConventionalSubject({
  header,
}: {
  header: NonNullable<ReturnType<typeof parseConventionalHeader>>
}) {
  return (
    <>
      <span
        className={cn('font-mono font-medium', TYPE_COLOR[header.type] ?? 'text-muted-foreground')}
      >
        {header.type}
      </span>
      {header.scope && (
        <span className="font-mono text-muted-foreground/70">
          (<span className={SCOPE_COLOR}>{header.scope}</span>)
        </span>
      )}
      {header.breaking && (
        <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">!</span>
      )}
      <span className="text-muted-foreground">: </span>
      <span>{header.description}</span>
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  )
}

function formatPerson(name: string, email: string): string {
  if (name && email) return `${name} <${email}>`
  return name || email || 'unknown'
}
