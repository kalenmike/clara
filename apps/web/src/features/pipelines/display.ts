import type {
  Pipeline,
  PipelineStage,
  StageCondition,
  StageGate,
  StagePhase,
} from '@clara/shared-types'

const PHASE_LABELS: Record<StagePhase, string> = {
  contract: 'Contract',
  work: 'Work',
  review: 'Review',
  close: 'Close',
}

/**
 * Phase accents use the theme's chart tokens, so custom palettes still read as
 * a single system. The label always carries the meaning; color is secondary.
 */
const PHASE_COLORS: Record<StagePhase, string> = {
  contract: 'var(--primary)',
  work: 'var(--chart-4)',
  review: 'var(--chart-5)',
  close: 'var(--chart-3)',
}

export function phaseLabel(phase: StagePhase): string {
  return PHASE_LABELS[phase]
}

export function phaseColor(phase: StagePhase): string {
  return PHASE_COLORS[phase]
}

export function formatGate(gate: StageGate): string {
  return gate.position === 'before'
    ? 'Human gate, before the stage starts'
    : 'Human gate, after the stage finishes'
}

export function formatCondition(condition: StageCondition | undefined): string {
  if (!condition) return 'Always runs'

  const key = condition.evidence
  if ('exists' in condition) {
    return condition.exists ? `Runs when ${key} has a value` : `Runs when ${key} has no value`
  }
  if ('equals' in condition) {
    return `Runs when ${key} equals ${formatValue(condition.equals)}`
  }
  if ('notEquals' in condition) {
    return `Runs when ${key} does not equal ${formatValue(condition.notEquals)}`
  }
  if ('in' in condition) {
    return `Runs when ${key} is one of ${formatList(condition.in)}`
  }
  if ('notIn' in condition) {
    return `Runs when ${key} is not one of ${formatList(condition.notIn)}`
  }
  return `Runs when ${key} matches a condition`
}

export function stagePath(pipeline: Pipeline): string {
  return pipeline.stages.map((stage) => stage.title).join(' → ')
}

export function summaryParts(pipeline: Pipeline): string[] {
  const gates = pipeline.stages.filter((stage) => stage.gate).length
  const conditional = pipeline.stages.filter((stage) => stage.when).length
  const closers = pipeline.stages.filter((stage) => stage.role === 'closer').length
  const parts = [`${pipeline.stages.length} stage${pipeline.stages.length === 1 ? '' : 's'}`]

  if (gates > 0) parts.push(`${gates} human gate${gates === 1 ? '' : 's'}`)
  if (conditional > 0) parts.push(`${conditional} conditional`)
  if (closers > 0) parts.push(`${closers} closer`)

  if (pipeline.progressGuard) {
    const { metric, samples } = pipeline.progressGuard
    parts.push(samples === undefined ? `guard ${metric}` : `guard ${metric} × ${samples}`)
  }

  return parts
}

export function evidenceCount(stage: PipelineStage): number {
  return Object.keys(stage.evidence ?? {}).length
}

function formatList(values: unknown[] | undefined): string {
  if (!values || values.length === 0) return 'an empty list'
  return values.map((value) => formatValue(value)).join(', ')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    if (value === '') return '""'
    return /^[\w./-]+$/.test(value) ? value : JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${formatList(value)}]`
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
