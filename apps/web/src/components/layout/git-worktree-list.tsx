import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@clara/ui/components/badge'
import { Button } from '@clara/ui/components/button'
import { Skeleton } from '@clara/ui/components/skeleton'
import { useGitWorktrees } from '@/features/git/use-git'
import { useConnection } from '@/providers/connection-provider'
import { cn } from '@clara/ui/lib/utils'
import { errorMessage } from '@/lib/errors'
import { GitPanelMessage } from './git-panel-parts'

/**
 * Every worktree the harness knows about for this project. The server returns
 * directories only, so the default row is the project's canonical directory and
 * the current row is the session's own directory.
 */
export function GitWorktreeList({
  projectID,
  directory,
  canonical,
}: {
  projectID: string | undefined
  directory: string
  canonical: string | undefined
}) {
  const { client } = useConnection()
  const queryClient = useQueryClient()
  const query = useGitWorktrees(projectID, directory, canonical, Boolean(projectID))
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string>()

  const rescan = async () => {
    if (!client || !projectID) return
    setScanning(true)
    setScanError(undefined)
    try {
      await client.worktree.refresh({ projectID })
      await queryClient.invalidateQueries({ queryKey: ['git', 'worktrees'] })
    } catch (cause) {
      setScanError(errorMessage(cause))
    } finally {
      setScanning(false)
    }
  }

  if (!projectID) {
    return (
      <GitPanelMessage
        title="No project"
        description="This session is not attached to a project record, so worktrees are unavailable."
      />
    )
  }

  const header = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-muted-foreground">
        {query.data
          ? `${query.data.length} worktree${query.data.length === 1 ? '' : 's'}`
          : 'Loading'}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0 max-md:size-11"
        onClick={() => void rescan()}
        disabled={scanning}
        title="Rescan worktrees"
      >
        {scanning ? (
          <Loader2 className="size-3 animate-spin max-md:size-5" />
        ) : (
          <RefreshCw className="size-3 max-md:size-5" />
        )}
        <span className="sr-only">Rescan worktrees</span>
      </Button>
    </div>
  )

  return (
    <div className="space-y-2">
      {header}

      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      ) : query.isError ? (
        <div className="space-y-1 rounded-lg border border-dashed p-2 text-[10px] text-muted-foreground">
          <p>Could not read worktrees.</p>
          <p className="truncate font-mono text-[9px]">{errorMessage(query.error)}</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] max-md:h-11 max-md:px-3 max-md:text-sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (query.data?.length ?? 0) === 0 ? (
        <p className="py-6 text-center text-[10px] text-muted-foreground">No worktrees reported.</p>
      ) : (
        <ul className="space-y-1">
          {query.data?.map((worktree) => (
            <li
              key={worktree.directory}
              className={cn(
                'space-y-0.5 rounded-md px-1.5 py-1',
                worktree.isCurrent && 'bg-muted/60'
              )}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <FolderGit2 className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-[10px]" title={worktree.directory}>
                  {basename(worktree.directory)}
                </span>
                {worktree.isCurrent && (
                  <Badge variant="secondary" className="shrink-0 text-[9px]">
                    current
                  </Badge>
                )}
                {worktree.isDefault && (
                  <Badge variant="outline" className="shrink-0 text-[9px]">
                    default
                  </Badge>
                )}
              </div>
              <p className="truncate pl-[18px] font-mono text-[9px] text-muted-foreground">
                {worktree.directory}
              </p>
            </li>
          ))}
        </ul>
      )}

      {scanError && (
        <p className="text-[9px] text-amber-600 dark:text-amber-400">Rescan failed: {scanError}</p>
      )}
    </div>
  )
}

function basename(value: string): string {
  const trimmed = value.replace(/\/+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed
}
