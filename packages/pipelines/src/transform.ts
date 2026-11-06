import { createHash } from 'node:crypto'
import type { Pipeline, PipelineStage, StageCondition } from '@clara/shared-types'
import { validatePipeline } from './validate.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function pipelineHash(pipeline: Pipeline): string {
  return `sha256:${createHash('sha256').update(canonical(pipeline)).digest('hex')}`
}

export function pipelineSnapshot(pipeline: Pipeline): string {
  return JSON.stringify(pipeline)
}

export function parsePipelineSnapshot(snapshot: string): Pipeline {
  const parsed: unknown = JSON.parse(snapshot)
  const validation = validatePipeline(parsed)
  if (!validation.pipeline) {
    throw new Error(`Clara: pinned pipeline is invalid: ${validation.errors.join('; ')}`)
  }
  return validation.pipeline
}

export function evaluateCondition(
  condition: StageCondition | undefined,
  evidence: Map<string, unknown>
): boolean {
  if (!condition) return true
  const value = evidence.get(condition.evidence)

  if ('exists' in condition) {
    return condition.exists === (value !== undefined && value !== null)
  }
  if (value === undefined || value === null) return false
  if ('equals' in condition) return canonical(value) === canonical(condition.equals)
  if ('notEquals' in condition) return canonical(value) !== canonical(condition.notEquals)
  if ('in' in condition)
    return (condition.in ?? []).some((item) => canonical(item) === canonical(value))
  if ('notIn' in condition)
    return !(condition.notIn ?? []).some((item) => canonical(item) === canonical(value))
  return true
}

export type PipelineRequestContext = Record<string, unknown>
export type PipelineWorkspaceContext = Record<string, unknown>

export function renderInstructions(
  stage: PipelineStage,
  pipeline: Pipeline,
  request: PipelineRequestContext,
  workspace: PipelineWorkspaceContext
): string {
  const values: Record<string, string> = {
    'request.id': String(request.id),
    'request.slug': String(request.slug),
    'request.title': String(request.title),
    'request.intent': String(request.intent),
    'request.record': String(request.record_path ?? '—'),
    'request.state': String(request.state),
    'workspace.name': String(workspace.name),
    'workspace.path': String(workspace.path),
    'pipeline.id': pipeline.id,
    'pipeline.name': pipeline.name,
    'pipeline.version': String(pipeline.version),
    'stage.id': stage.id,
    'stage.title': stage.title,
    'stage.phase': stage.phase,
  }
  return stage.instructions.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (match, key: string) => {
    return key in values ? values[key] : match
  })
}
