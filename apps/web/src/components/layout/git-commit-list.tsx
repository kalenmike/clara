import { AlertCircle, GitCommitHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { shellFailure, useGitCommits } from '@/features/git/use-git'
import { errorMessage } from '@/lib/errors'
import { GitPanelMessage } from './git-panel-parts'

/** Recent commits from the session's own directory, via the host agent. */
export function GitCommitList({ directory }: { directory: string }) {
  const query = useGitCommits(directory, true)

  if (query.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    )
  }

  if (query.isError) {
    const failure = shellFailure(query.error)
    const retry = (
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-[10px] max-md:h-11 max-md:px-3 max-md:text-sm"
        onClick={() => void query.refetch()}
      >
        Retry
      </Button>
    )

    if (failure === 'blocked') {
      return (
        <GitPanelMessage
          title="Commit history is disabled"
          description="An admin blocked shell commands on the Clara server. Enable it in the agent panel under Shell commands."
        />
      )
    }

    if (failure === 'unsupported') {
      return (
        <GitPanelMessage
          title="Commit history is unavailable"
          description="This OpenCode server does not expose shell jobs, so Clara cannot read the log."
        />
      )
    }

    return (
      <div className="space-y-2 rounded-lg border border-dashed p-2">
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p>Could not read commit history.</p>
            <p className="truncate font-mono text-[9px]">{errorMessage(query.error)}</p>
          </div>
        </div>
        {retry}
      </div>
    )
  }

  const commits = query.data ?? []

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-8 text-center text-muted-foreground">
        <GitCommitHorizontal className="size-5" />
        <p className="text-[10px]">No commits yet.</p>
      </div>
    )
  }

  return (
    <ul className="space-y-1.5">
      {commits.map((commit) => (
        <li key={commit.hash} className="flex items-start gap-1.5">
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {commit.hash.slice(0, 7)}
          </span>
          <span className="min-w-0 truncate text-[10px]" title={commit.subject}>
            {commit.subject}
          </span>
        </li>
      ))}
    </ul>
  )
}
