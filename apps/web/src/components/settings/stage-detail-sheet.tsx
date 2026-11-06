import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { EvidenceSpec, Pipeline, PipelineStage } from '@clara/shared-types'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { formatCondition, formatGate } from '@/features/pipelines/display'
import { useMediaQuery } from '@/hooks/use-media-query'
import { PhaseBadge } from './pipeline-row'

export type StageSelection = {
  pipeline: Pipeline
  stage: PipelineStage
  index: number
}

export function StageDetailSheet({
  selection,
  onOpenChange,
}: {
  selection: StageSelection | null
  onOpenChange: (open: boolean) => void
}) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const stage = selection?.stage
  const pipeline = selection?.pipeline

  return (
    <Sheet open={selection !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'max-h-[85vh] overflow-y-auto pb-[calc(1rem_+_env(safe-area-inset-bottom))]'
            : 'w-full overflow-y-auto sm:max-w-lg'
        }
      >
        {stage && pipeline && selection && (
          <>
            <SheetHeader className="pr-10">
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle>{stage.title}</SheetTitle>
                <PhaseBadge phase={stage.phase} />
              </div>
              <SheetDescription>
                Stage {selection.index + 1} of {pipeline.stages.length} · agent{' '}
                <span className="font-mono">{stage.agent}</span> · {stage.role}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-5 px-4 pb-6">
              <Section title="Instructions">
                <p className="rounded-lg bg-muted/40 p-3 text-sm whitespace-pre-wrap">
                  {stage.instructions}
                </p>
                {stage.instructions.includes('{{') && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Template variables resolve when the stage runs.
                  </p>
                )}
              </Section>

              <Section title="Evidence">
                <EvidenceList evidence={stage.evidence} />
              </Section>

              <div className="grid gap-3 sm:grid-cols-2">
                <Detail
                  label="Gate"
                  value={stage.gate ? formatGate(stage.gate) : 'No human gate'}
                />
                <Detail label="Condition" value={formatCondition(stage.when)} />
              </div>

              <Detail
                label="Stage id"
                value={<code className="font-mono text-xs">{stage.id}</code>}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  )
}

function EvidenceList({ evidence }: { evidence: Record<string, EvidenceSpec> | undefined }) {
  const entries = Object.entries(evidence ?? {})
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No evidence required.</p>
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, spec]) => (
        <div key={key} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs">{key}</code>
            <Badge variant="secondary" className="text-[10px]">
              {spec.type}
            </Badge>
            {spec.required && (
              <Badge variant="outline" className="text-[10px]">
                required
              </Badge>
            )}
            {spec.immutable && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Lock className="size-3" />
                immutable
              </Badge>
            )}
          </div>
          {spec.description && (
            <p className="mt-1.5 text-xs text-muted-foreground">{spec.description}</p>
          )}
        </div>
      ))}
    </div>
  )
}
