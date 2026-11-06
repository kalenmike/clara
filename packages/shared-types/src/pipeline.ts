/**
 * Pipeline definitions are user-level JSON, so the wire types live beside the
 * other Clara types. The validation and loading code lives in
 * `@clara/pipelines`; this file stays free of Node-only imports.
 */

export const PIPELINE_SCHEMA_VERSION = 1
export const SOFTWARE_PIPELINE_ID = 'software'

export const STAGE_PHASES = ['contract', 'work', 'review', 'close'] as const
export type StagePhase = (typeof STAGE_PHASES)[number]

export const STAGE_ROLES = ['worker', 'closer'] as const
export type StageRole = (typeof STAGE_ROLES)[number]

export const EVIDENCE_TYPES = ['string', 'number', 'boolean', 'object', 'array'] as const
export type EvidenceType = (typeof EVIDENCE_TYPES)[number]

export type EvidenceSpec = {
  type: EvidenceType
  required?: boolean
  immutable?: boolean
  description?: string
}

export type StageCondition = {
  evidence: string
  equals?: unknown
  notEquals?: unknown
  in?: unknown[]
  notIn?: unknown[]
  exists?: boolean
}

export type StageGate = {
  position: 'before' | 'after'
  kind: 'human'
}

export type PipelineStage = {
  id: string
  title: string
  phase: StagePhase
  agent: string
  role: StageRole
  instructions: string
  evidence?: Record<string, EvidenceSpec>
  when?: StageCondition
  gate?: StageGate
}

export type ProgressGuard = {
  metric: string
  samples?: number
}

export type Pipeline = {
  schemaVersion: number
  id: string
  name: string
  version: number
  description?: string
  progressGuard?: ProgressGuard
  stages: PipelineStage[]
}

export type LoadedPipeline = {
  pipeline: Pipeline
  source: 'builtin' | 'file'
  path?: string
}

export type PipelineLoadError = {
  path?: string
  id?: string
  errors: string[]
}

/** One custom file that loaded successfully. */
export type CustomPipeline = {
  pipeline: Pipeline
  path: string
}

/**
 * The read-only catalog shown in Settings. Built-ins and custom files are kept
 * separate so an override can be described instead of hidden.
 */
export type PipelineCatalog = {
  /** Absolute path of the user pipeline directory on the home agent. */
  directory: string
  builtins: Pipeline[]
  custom: CustomPipeline[]
  errors: PipelineLoadError[]
}
