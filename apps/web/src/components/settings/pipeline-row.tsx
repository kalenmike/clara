import { useState } from 'react'
import { Bot, ChevronDown, Copy, FileJson, GitBranch, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { Pipeline, PipelineStage, StagePhase } from '@clara/shared-types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  evidenceCount,
  phaseColor,
  phaseLabel,
  stagePath,
  summaryParts,
} from '@/features/pipelines/display'
import { cn } from '@/lib/utils'

export function PipelineRow({
  pipeline,
  source,
  path,
  overridden,
  replaces,
  onOpenStage,
}: {
  pipeline: Pipeline
  source: 'builtin' | 'file'
  path?: string
  /** A custom file replaces this built-in preset. */
  overridden?: boolean
  /** This custom file replaces a built-in preset. */
  replaces?: Pipeline
  onOpenStage: (stage: PipelineStage, index: number) => void
}) {
  const [open, setOpen] = useState(false)
  const custom = source === 'file'

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn('rounded-lg border bg-background transition-colors', open && 'bg-muted/20')}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-expanded={open}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{pipeline.name}</span>
              <Badge variant={custom ? 'secondary' : 'outline'} className="text-[10px]">
                {custom ? 'Custom' : 'Built-in'}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                v{pipeline.version}
              </Badge>
              <code className="text-[10px] text-muted-foreground">{pipeline.id}</code>
              {overridden && (
                <Badge variant="outline" className="text-[10px]">
                  Overridden by custom
                </Badge>
              )}
              {replaces && (
                <Badge variant="outline" className="text-[10px]">
                  Replaces built-in v{replaces.version}
                </Badge>
              )}
            </div>

            {pipeline.description && (
              <p className="mt-1 text-sm text-muted-foreground">{pipeline.description}</p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              {summaryParts(pipeline).map((part, index) => (
                <span key={part}>
                  {index > 0 && <span className="mr-2">·</span>}
                  {part}
                </span>
              ))}
            </div>

            <p className="mt-1 text-xs text-muted-foreground/90">{stagePath(pipeline)}</p>

            {overridden && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                A custom file replaces this preset for new requests.
              </p>
            )}
            {replaces && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                New requests use this definition. Requests already running keep the pipeline they
                started with.
              </p>
            )}
          </div>

          <ChevronDown
            className={cn(
              'mt-1 size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-3 pb-3">
          <ol className="space-y-0">
            {pipeline.stages.map((stage, index) => (
              <li key={stage.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-[11px] font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  {index < pipeline.stages.length - 1 && (
                    <span className="my-1 w-px flex-1 bg-border" aria-hidden="true" />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenStage(stage, index)}
                  className="mb-2 min-w-0 flex-1 rounded-md p-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{stage.title}</span>
                    <PhaseBadge phase={stage.phase} />
                    {stage.gate && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <ShieldCheck className="size-3" />
                        {stage.gate.position === 'before' ? 'Gate before' : 'Gate after'}
                      </Badge>
                    )}
                    {stage.when && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <GitBranch className="size-3" />
                        Conditional
                      </Badge>
                    )}
                    {stage.role === 'closer' && (
                      <Badge variant="secondary" className="text-[10px]">
                        Closer
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Bot className="size-3" />
                      agent <span className="font-mono">{stage.agent}</span>
                    </span>
                    {evidenceCount(stage) > 0 && (
                      <span>
                        {evidenceCount(stage)} evidence
                        {evidenceCount(stage) === 1 ? '' : ' fields'}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ol>

          {path && <PipelinePath path={path} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function PhaseBadge({ phase }: { phase: StagePhase }) {
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: phaseColor(phase) }}
        aria-hidden="true"
      />
      {phaseLabel(phase)}
    </Badge>
  )
}

function PipelinePath({ path }: { path: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      toast.success('Pipeline path copied')
    } catch {
      toast.error('Could not copy the pipeline path')
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
      <FileJson className="size-3.5 shrink-0" />
      <code className="min-w-0 flex-1 truncate" title={path}>
        {path}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => void copy()}
        aria-label="Copy pipeline path"
        title="Copy pipeline path"
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  )
}
