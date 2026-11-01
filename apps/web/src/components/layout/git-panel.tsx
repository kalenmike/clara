import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, GitBranch, GitCommitHorizontal, Loader2, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { VcsFileStatus } from '@opencode/client'
import { GitCommitList } from '@/components/layout/git-commit-list'
import { GitPanelMessage } from '@/components/layout/git-panel-parts'
import { GitWorktreeList } from '@/components/layout/git-worktree-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGitBase, useGitChanges, useGitInfo, type GitRange } from '@/features/git/use-git'
import { useSessionWording } from '@/features/sessions/use-wording'
import { isRelayConfig } from '@/lib/client'
import { errorMessage } from '@/lib/errors'
import { formatCount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useConnection } from '@/providers/connection-provider'

const STATUS_COLOR: Record<VcsFileStatus['status'], string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-amber-600 dark:text-amber-400',
  deleted: 'text-rose-600 dark:text-rose-400',
}

const STATUS_LABEL: Record<VcsFileStatus['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

type GitView = 'changes' | 'commits' | 'worktrees'

export function GitPanel({
  directory,
  projectID,
  canonical,
}: {
  directory: string | undefined
  projectID: string | undefined
  /** The project's canonical directory, used to mark the default worktree. */
  canonical: string | undefined
}) {
  const { config } = useConnection()
  const queryClient = useQueryClient()
  const infoQuery = useGitInfo(directory)
  const baseQuery = useGitBase(directory)
  const { lowerSingular } = useSessionWording()
  const [range, setRange] = useState<GitRange>('working')
  const [view, setView] = useState<GitView>('changes')
  const [fallbackBase, setFallbackBase] = useState<string | undefined>()

  useEffect(() => {
    setFallbackBase(undefined)
  }, [directory])

  /**
   * Commit history runs `git log` on the host, so it only exists when the
   * request travels through the home agent and its shell policy.
   */
  const hostCommands = Boolean(config && isRelayConfig(config))

  const info = infoQuery.data
  const currentBranch = info?.branch.current
  const defaultBranch = info?.branch.default ?? baseQuery.data?.name
  const isRepo = Boolean(info?.provider || currentBranch || defaultBranch)
  const effectiveRange = range === 'branch' && !defaultBranch ? 'working' : range
  const base =
    effectiveRange === 'commits'
      ? (fallbackBase ?? 'HEAD~3')
      : effectiveRange === 'branch'
        ? defaultBranch
        : undefined

  const changesQuery = useGitChanges(directory, effectiveRange, base)
  const files = useMemo(() => changesQuery.data ?? [], [changesQuery.data])
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [files]
  )
  const sorted = useMemo(
    () =>
      [...files].sort(
        (left, right) => right.additions + right.deletions - (left.additions + left.deletions)
      ),
    [files]
  )
  const maxChurn = useMemo(
    () => Math.max(1, ...files.map((file) => file.additions + file.deletions)),
    [files]
  )
  const fetching = infoQuery.isFetching || baseQuery.isFetching || changesQuery.isFetching

  const refresh = () => {
    void infoQuery.refetch()
    void baseQuery.refetch()
    void changesQuery.refetch()
    // Only the active history or worktree query refetches, so a refresh on the
    // changes view cannot spawn a `git log` shell job.
    void queryClient.invalidateQueries({ queryKey: ['git'] })
  }

  const changeRange = (value: string) => {
    setFallbackBase(undefined)
    setRange(value as GitRange)
  }

  if (!directory) {
    return (
      <GitPanelMessage
        title="No directory"
        description={`This ${lowerSingular} is not attached to a project directory.`}
      />
    )
  }

  if (infoQuery.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (infoQuery.isError) {
    return (
      <GitPanelMessage
        title="Could not read git information"
        description="The server did not answer the git request."
        action={
          <Button
            variant="outline"
            size="sm"
            className="max-md:h-11 max-md:px-3 max-md:text-sm"
            onClick={() => void infoQuery.refetch()}
          >
            Retry
          </Button>
        }
      />
    )
  }

  if (!info || !isRepo) {
    return (
      <GitPanelMessage
        title="Not a git repository"
        description={`${directory} has no git repository.`}
      />
    )
  }

  const rangeLabel =
    effectiveRange === 'working'
      ? 'HEAD → working tree'
      : effectiveRange === 'commits'
        ? `${base} → HEAD`
        : `${defaultBranch ?? 'base'}...HEAD`

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5 font-medium">
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{currentBranch || 'detached HEAD'}</span>
            {currentBranch && currentBranch === defaultBranch && (
              <Badge variant="secondary" className="shrink-0 text-[9px]">
                default
              </Badge>
            )}
          </div>
          <p className="truncate text-[10px] text-muted-foreground">
            base {defaultBranch || 'unknown'} · {info.provider ?? 'git'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 max-md:size-11"
          onClick={refresh}
          disabled={fetching}
          title="Refresh git changes"
        >
          {fetching ? (
            <Loader2 className="size-3.5 animate-spin max-md:size-5" />
          ) : (
            <RefreshCw className="size-3.5 max-md:size-5" />
          )}
          <span className="sr-only">Refresh git changes</span>
        </Button>
      </div>

      <Separator />

      <Tabs value={view} onValueChange={(value) => setView(value as GitView)} className="gap-2">
        <TabsList className="h-7 w-full max-md:h-11">
          <TabsTrigger value="changes" className="text-[11px] max-md:text-sm">
            Changes
          </TabsTrigger>
          <TabsTrigger value="commits" className="text-[11px] max-md:text-sm">
            Commits
          </TabsTrigger>
          <TabsTrigger value="worktrees" className="text-[11px] max-md:text-sm">
            Worktrees
          </TabsTrigger>
        </TabsList>

        <TabsContent value="changes" className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Compare</span>
              <Select value={effectiveRange} onValueChange={changeRange}>
                <SelectTrigger size="sm" className="h-7 text-[11px] max-md:h-11 max-md:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="working">Working tree</SelectItem>
                  <SelectItem value="commits">Last 3 commits</SelectItem>
                  <SelectItem value="branch" disabled={!defaultBranch}>
                    Base branch
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{rangeLabel}</p>
            {fallbackBase && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                Last 3 commits unavailable; showing the last commit.
              </p>
            )}
          </div>

          <Separator />

          {changesQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : changesQuery.isError ? (
            <ChangeError
              range={effectiveRange}
              message={errorMessage(changesQuery.error)}
              onRetry={() => void changesQuery.refetch()}
              onShowLastCommit={
                effectiveRange === 'commits' && !fallbackBase
                  ? () => setFallbackBase('HEAD~1')
                  : undefined
              }
            />
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center text-muted-foreground">
              <GitCommitHorizontal className="size-5" />
              <p className="text-[10px]">No changes in this range.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">
                    {formatCount(files.length)} file{files.length === 1 ? '' : 's'}
                  </span>
                  <span className="font-mono">
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{formatCount(totals.additions)}
                    </span>{' '}
                    <span className="text-rose-600 dark:text-rose-400">
                      −{formatCount(totals.deletions)}
                    </span>
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${(totals.additions / Math.max(1, totals.additions + totals.deletions)) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-rose-500"
                    style={{
                      width: `${(totals.deletions / Math.max(1, totals.additions + totals.deletions)) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <ul className="space-y-2">
                {sorted.map((file) => (
                  <FileRow key={file.file} file={file} maxChurn={maxChurn} />
                ))}
              </ul>
            </>
          )}
        </TabsContent>

        <TabsContent value="commits">
          {hostCommands ? (
            <GitCommitList directory={directory} />
          ) : (
            <GitPanelMessage
              title="Commit history needs the home agent"
              description="Clara runs the log on the host through the Clara server. A direct OpenCode connection has no agent to apply the shell policy."
            />
          )}
        </TabsContent>

        <TabsContent value="worktrees">
          <GitWorktreeList projectID={projectID} directory={directory} canonical={canonical} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FileRow({ file, maxChurn }: { file: VcsFileStatus; maxChurn: number }) {
  const slash = file.file.lastIndexOf('/')
  const directory = slash >= 0 ? file.file.slice(0, slash) : ''
  const name = slash >= 0 ? file.file.slice(slash + 1) : file.file
  const churn = file.additions + file.deletions

  return (
    <li className="space-y-1">
      <div className="flex items-start gap-1.5">
        <span
          className={cn(
            'mt-0.5 w-3 shrink-0 font-mono text-[10px] font-semibold',
            STATUS_COLOR[file.status]
          )}
          title={file.status}
        >
          {STATUS_LABEL[file.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-mono text-[10px]" title={file.file}>
              {name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-emerald-600 dark:text-emerald-400">
              +{formatCount(file.additions)}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-rose-600 dark:text-rose-400">
              −{formatCount(file.deletions)}
            </span>
          </div>
          {directory && (
            <p className="truncate font-mono text-[9px] text-muted-foreground">{directory}</p>
          )}
        </div>
      </div>
      <div className="ml-[18px] h-0.5 overflow-hidden rounded-full bg-muted/60">
        <div className="flex h-full" style={{ width: `${Math.max(4, (churn / maxChurn) * 100)}%` }}>
          <div
            className="h-full bg-emerald-500/70"
            style={{ width: `${(file.additions / Math.max(1, churn)) * 100}%` }}
          />
          <div
            className="h-full bg-rose-500/70"
            style={{ width: `${(file.deletions / Math.max(1, churn)) * 100}%` }}
          />
        </div>
      </div>
    </li>
  )
}

function ChangeError({
  range,
  message,
  onRetry,
  onShowLastCommit,
}: {
  range: GitRange
  message: string
  onRetry: () => void
  onShowLastCommit: (() => void) | undefined
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-2">
      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 space-y-1">
          <p>
            {range === 'commits'
              ? 'The last 3 commits are unavailable. This repository may have fewer commits.'
              : 'Could not load changes for this range.'}
          </p>
          <p className="truncate font-mono text-[9px]">{message}</p>
        </div>
      </div>
      <div className="flex gap-1.5">
        {onShowLastCommit && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px] max-md:h-11 max-md:px-3 max-md:text-sm"
            onClick={onShowLastCommit}
          >
            Show last commit
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] max-md:h-11 max-md:px-3 max-md:text-sm"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </div>
  )
}
