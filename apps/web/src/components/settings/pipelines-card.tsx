import { useState } from 'react'
import { CircleAlert, FolderOpen, Loader2, Lock, RefreshCw, Workflow } from 'lucide-react'
import type { Pipeline, PipelineLoadError, PipelineStage } from '@clara/shared-types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PipelineRow } from '@/components/settings/pipeline-row'
import { StageDetailSheet, type StageSelection } from '@/components/settings/stage-detail-sheet'
import { usePipelines } from '@/features/pipelines/use-pipelines'
import { useConnection } from '@/providers/connection-provider'

export function PipelinesCard() {
  const pipelines = usePipelines()
  const { relayStatus } = useConnection()
  const [selection, setSelection] = useState<StageSelection | null>(null)
  const managementOff = relayStatus?.agent?.management === false
  const data = pipelines.data

  const openStage = (pipeline: Pipeline) => (stage: PipelineStage, index: number) => {
    setSelection({ pipeline, stage, index })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Workflow className="size-4" /> Pipelines
          </CardTitle>
          <CardDescription>
            The request workflows Clara can run. Stages run in order, starting with a contract stage
            and ending with a close stage.
          </CardDescription>
          <CardAction className="flex flex-wrap items-center justify-end gap-2 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start">
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" />
              Read-only
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void pipelines.refetch()}
              disabled={pipelines.isFetching}
            >
              {pipelines.isFetching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-6">
          {managementOff && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              Clara management is off. These pipelines are visible for reference, but new requests
              will not run them.
            </p>
          )}

          {pipelines.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}

          {pipelines.isError && (
            <Alert variant="destructive" className="items-start">
              <CircleAlert />
              <AlertTitle>Could not load pipelines</AlertTitle>
              <AlertDescription>
                <p className="mb-3">
                  {pipelines.error instanceof Error
                    ? pipelines.error.message
                    : 'The home agent did not return a pipeline catalog.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void pipelines.refetch()}
                  disabled={pipelines.isFetching}
                >
                  <RefreshCw className="size-4" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {data && (
            <>
              <section className="space-y-2">
                <SectionHeader label="Built-in" count={data.builtins.length} />
                {data.builtins.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No built-in pipelines are available.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.builtins.map((pipeline) => (
                      <PipelineRow
                        key={pipeline.id}
                        pipeline={pipeline}
                        source="builtin"
                        overridden={data.custom.some((entry) => entry.pipeline.id === pipeline.id)}
                        onOpenStage={openStage(pipeline)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <SectionHeader label="Custom" count={data.custom.length} />
                <p className="text-[11px] text-muted-foreground">
                  Loaded from{' '}
                  <code className="break-all rounded bg-muted px-1 py-0.5">{data.directory}</code>
                </p>

                {data.custom.length > 0 && (
                  <div className="space-y-2">
                    {data.custom.map(({ pipeline, path }) => (
                      <PipelineRow
                        key={pipeline.id}
                        pipeline={pipeline}
                        source="file"
                        path={path}
                        replaces={data.builtins.find((builtin) => builtin.id === pipeline.id)}
                        onOpenStage={openStage(pipeline)}
                      />
                    ))}
                  </div>
                )}

                {data.custom.length === 0 && data.errors.length === 0 && (
                  <EmptyCustom directory={data.directory} />
                )}

                {data.errors.length > 0 && (
                  <div className="space-y-2">
                    {data.errors.map((error, index) => (
                      <PipelineErrorCard
                        key={`${error.path ?? error.id ?? 'error'}-${index}`}
                        error={error}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </CardContent>
      </Card>

      <StageDetailSheet
        selection={selection}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
      />
    </>
  )
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h2>
      <span className="text-xs text-muted-foreground">{count}</span>
    </div>
  )
}

function EmptyCustom({ directory }: { directory: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
      <FolderOpen className="size-6 text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">No custom pipelines yet</p>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">
        Custom pipelines are JSON files in{' '}
        <code className="break-all rounded bg-muted px-1 py-0.5">{directory}</code>. Add one there
        and choose Refresh.
      </p>
    </div>
  )
}

function PipelineErrorCard({ error }: { error: PipelineLoadError }) {
  return (
    <Alert variant="destructive" className="items-start">
      <CircleAlert />
      <AlertTitle>{error.id ? `Invalid "${error.id}"` : 'Invalid pipeline file'}</AlertTitle>
      <AlertDescription>
        {error.path && (
          <p className="mb-1 truncate font-mono text-[11px]" title={error.path}>
            {error.path}
          </p>
        )}
        <ul className="list-disc space-y-1 pl-4 text-xs">
          {error.errors.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
