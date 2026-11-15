import { AlertCircle, GitCommitHorizontal } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Skeleton } from '@clara/ui/components/skeleton'
import { gitHistoryFailure, useGitCommits, type CommitWindow } from '@/features/git/use-git'
import { errorMessage } from '@/lib/errors'
import { GitCommitRow } from './git-commit-row'
import { GitPanelMessage } from './git-panel-parts'

/** Commits made between the session start and its latest message. */
export function GitCommitList({
  directory,
  commitWindow,
}: {
  directory: string
  /** The session window, used to scope the log on the host. */
  commitWindow: CommitWindow | undefined
}) {
  const query = useGitCommits(directory, commitWindow, Boolean(commitWindow))
  const commits = query.data ?? []
  const empty = (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center text-muted-foreground">
      <GitCommitHorizontal className="size-5" />
      <p className="text-[10px]">No commits since this session started.</p>
    </div>
  )

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-muted-foreground">Commits since session start</p>
      {commitWindow === undefined ? (
        empty
      ) : query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ) : query.isError ? (
        <CommitError query={query} />
      ) : commits.length === 0 ? (
        empty
      ) : (
        <ul className="space-y-1.5">
          {commits.map((commit) => (
            <GitCommitRow key={commit.hash} commit={commit} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CommitError({ query }: { query: ReturnType<typeof useGitCommits> }) {
  const failure = gitHistoryFailure(query.error)
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

  if (failure === 'disabled') {
    return (
      <GitPanelMessage
        title="Commit history is disabled"
        description="An admin disabled harness access on the Clara hub. Enable it in the hub panel."
      />
    )
  }

  if (failure === 'unconfigured') {
    return (
      <GitPanelMessage
        title="Commit history is unavailable"
        description="No harness is configured. Set one up in the hub panel."
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
