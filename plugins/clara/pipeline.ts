// Clara — pipeline definitions.
//
// A pipeline is the user-configurable part of a request: the ordered stages,
// the agent that runs each one, the handoff instructions, and the evidence a
// stage must record before the daemon advances. The Clara lifecycle stays
// fixed; this file only describes what happens inside it.
//
// Definitions are user-level JSON files. Nothing here reads a workspace file,
// because a repository must not be able to define shell-capable agents.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { configDir, type Db, type Row } from './db.ts'

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

const TEMPLATE_VARIABLES = new Set([
  'request.id',
  'request.slug',
  'request.title',
  'request.intent',
  'request.record',
  'request.state',
  'workspace.name',
  'workspace.path',
  'pipeline.id',
  'pipeline.name',
  'pipeline.version',
  'stage.id',
  'stage.title',
  'stage.phase',
])

const CONDITION_OPERATORS = ['equals', 'notEquals', 'in', 'notIn', 'exists'] as const

/**
 * The built-in software pipeline. It mirrors the original five stages, so a
 * fresh ledger and the existing Clara agents keep working without a config
 * file. A user file with id `software` overrides it.
 */
export const SOFTWARE_PIPELINE: Pipeline = {
  schemaVersion: PIPELINE_SCHEMA_VERSION,
  id: SOFTWARE_PIPELINE_ID,
  name: 'Software request',
  version: 1,
  description: 'Spec, freeze tests, build, apply docs, close.',
  progressGuard: { metric: 'tests_passed', samples: 3 },
  stages: [
    {
      id: 'spec',
      title: 'Spec',
      phase: 'contract',
      agent: '001',
      role: 'worker',
      instructions:
        'Propose the acceptance criteria with clara_criteria. Every criterion needs a test_path or human_gate=true. Do not read source code; use the request record and the docs it points at. Then call clara_stage_done with {"criteria_count": <n>, "docs_impact": "<impact or none>"}. A human must approve.',
      evidence: {
        criteria_count: { type: 'number', required: true },
        docs_impact: { type: 'string' },
      },
    },
    {
      id: 'test',
      title: 'Test',
      phase: 'work',
      agent: '002',
      role: 'worker',
      instructions:
        'Write the tests that define done for the approved criteria. Use clara_ask to read them. Then call clara_stage_done with {"tests_hash": "<hash>", "tests_total": <n>}. The hash is immutable after that. Do not edit source.',
      evidence: {
        tests_hash: { type: 'string', required: true, immutable: true },
        tests_total: { type: 'number' },
      },
    },
    {
      id: 'build',
      title: 'Build',
      phase: 'work',
      agent: '003',
      role: 'worker',
      instructions:
        'Implement the request against the frozen tests. Use clara_progress at each boundary. Do not edit tests. When complete, call clara_stage_done with {"summary": "<what changed>", "criteria_addressed": [<positions>]}. If a kill criterion fires, write progress with blocked_on and stop.',
      evidence: {
        summary: { type: 'string', required: true },
        criteria_addressed: { type: 'array' },
      },
    },
    {
      id: 'docs',
      title: 'Docs',
      phase: 'review',
      agent: '004',
      role: 'worker',
      instructions:
        "Apply the request's docs_impact to the workspace docs. Never edit docs/features or docs/index.md. If the impact no longer applies cleanly, reconcile against current truth and record it. When done, call clara_stage_done for this stage. If you cannot reconcile, open a decision with clara_decide and stop.",
      when: { evidence: 'docs_impact', notIn: ['', 'none', 'n/a', 'no'] },
    },
    {
      id: 'judge',
      title: 'Judge',
      phase: 'close',
      agent: 'judge',
      role: 'closer',
      instructions:
        'Close only from ledger evidence: call clara_ask once and check the criteria, stage evidence, and human gates. Do not read source or run commands; there is no shell and the close gate does not re-hash. If every gate is recorded, call clara_stage_done with {"result": "<final result>", "artifacts": [<paths, URLs, or text>]}. Otherwise open one decision with clara_decide and stop. Do not write code.',
      evidence: {
        result: { type: 'string', required: true },
        artifacts: { type: 'array' },
      },
    },
  ],
}

/**
 * A small non-software example. It exists to prove the daemon is not tied to
 * tests or docs, and to give authors something to copy.
 */
export const CONTENT_PIPELINE: Pipeline = {
  schemaVersion: PIPELINE_SCHEMA_VERSION,
  id: 'content',
  name: 'Content request',
  version: 1,
  description: 'Brief, draft, edit, deliver.',
  stages: [
    {
      id: 'brief',
      title: 'Brief',
      phase: 'contract',
      agent: 'clara-brief',
      role: 'worker',
      instructions:
        'Turn the request into a content brief with clara_criteria. Include audience, tone, length, and the call to action. Every criterion needs a human_gate or an artifact reference. Then call clara_stage_done with {"brief": "<brief>"}.',
      evidence: {
        brief: { type: 'string', required: true },
      },
    },
    {
      id: 'draft',
      title: 'Draft',
      phase: 'work',
      agent: 'clara-writer',
      role: 'worker',
      instructions:
        'Write the draft from the approved brief. Call clara_stage_done with {"copy": "<draft>", "word_count": <n>}.',
      evidence: {
        copy: { type: 'string', required: true },
        word_count: { type: 'number' },
      },
      gate: { position: 'after', kind: 'human' },
    },
    {
      id: 'edit',
      title: 'Edit',
      phase: 'review',
      agent: 'clara-editor',
      role: 'worker',
      instructions:
        'Edit the draft against the brief. Call clara_stage_done with {"final_copy": "<final copy>", "changes": "<summary>"}.',
      evidence: {
        final_copy: { type: 'string', required: true },
        changes: { type: 'string' },
      },
    },
    {
      id: 'deliver',
      title: 'Deliver',
      phase: 'close',
      agent: 'clara-closer',
      role: 'closer',
      instructions:
        'Deliver the final copy. Call clara_stage_done with {"result": "<delivery summary>", "artifacts": [<paths or URLs>]} to complete the request.',
      evidence: {
        result: { type: 'string', required: true },
        artifacts: { type: 'array' },
      },
    },
  ],
}

export function pipelineDir(): string {
  return join(configDir(), 'pipelines')
}

export function pipelinePath(id: string): string {
  return join(pipelineDir(), `${id}.json`)
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

export interface PipelineValidation {
  pipeline?: Pipeline
  errors: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPhase(value: unknown): value is StagePhase {
  return typeof value === 'string' && (STAGE_PHASES as readonly string[]).includes(value)
}

function isRole(value: unknown): value is StageRole {
  return typeof value === 'string' && (STAGE_ROLES as readonly string[]).includes(value)
}

function isEvidenceType(value: unknown): value is EvidenceType {
  return typeof value === 'string' && (EVIDENCE_TYPES as readonly string[]).includes(value)
}

function validateCondition(
  value: unknown,
  prefix: string,
  priorEvidence: Set<string>,
  errors: string[]
): StageCondition | undefined {
  if (!isRecord(value)) {
    errors.push(`${prefix}: must be an object`)
    return
  }
  if (!nonEmptyString(value.evidence)) {
    errors.push(`${prefix}.evidence: must be a non-empty string`)
    return
  }
  if (!priorEvidence.has(value.evidence)) {
    errors.push(`${prefix}.evidence: "${value.evidence}" is not declared by an earlier stage`)
  }

  const operators = CONDITION_OPERATORS.filter((operator) => operator in value)
  if (operators.length !== 1) {
    errors.push(`${prefix}: exactly one of ${CONDITION_OPERATORS.join(', ')} is required`)
  }

  if ('in' in value && !Array.isArray(value.in)) {
    errors.push(`${prefix}.in: must be an array`)
  }
  if ('notIn' in value && !Array.isArray(value.notIn)) {
    errors.push(`${prefix}.notIn: must be an array`)
  }
  if ('exists' in value && typeof value.exists !== 'boolean') {
    errors.push(`${prefix}.exists: must be a boolean`)
  }

  return {
    evidence: value.evidence,
    ...(operators.includes('equals') ? { equals: value.equals } : {}),
    ...(operators.includes('notEquals') ? { notEquals: value.notEquals } : {}),
    ...(operators.includes('in') && Array.isArray(value.in) ? { in: value.in } : {}),
    ...(operators.includes('notIn') && Array.isArray(value.notIn) ? { notIn: value.notIn } : {}),
    ...(operators.includes('exists') && typeof value.exists === 'boolean'
      ? { exists: value.exists }
      : {}),
  }
}

function validateEvidence(
  value: unknown,
  prefix: string,
  errors: string[]
): Record<string, EvidenceSpec> | undefined {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push(`${prefix}: must be an object`)
    return
  }

  const specs: Record<string, EvidenceSpec> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!nonEmptyString(key)) {
      errors.push(`${prefix}: evidence keys must be non-empty`)
      continue
    }
    if (!isRecord(raw)) {
      errors.push(`${prefix}.${key}: must be an object`)
      continue
    }
    if (!isEvidenceType(raw.type)) {
      errors.push(`${prefix}.${key}.type: must be one of ${EVIDENCE_TYPES.join(', ')}`)
      continue
    }
    if (raw.required !== undefined && typeof raw.required !== 'boolean') {
      errors.push(`${prefix}.${key}.required: must be a boolean`)
    }
    if (raw.immutable !== undefined && typeof raw.immutable !== 'boolean') {
      errors.push(`${prefix}.${key}.immutable: must be a boolean`)
    }
    if (raw.description !== undefined && typeof raw.description !== 'string') {
      errors.push(`${prefix}.${key}.description: must be a string`)
    }
    specs[key] = {
      type: raw.type,
      ...(raw.required === true ? { required: true } : {}),
      ...(raw.immutable === true ? { immutable: true } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    }
  }
  return specs
}

function validateGate(
  value: unknown,
  prefix: string,
  phase: StagePhase,
  errors: string[]
): StageGate | undefined {
  if (value === undefined) return
  if (phase === 'contract' || phase === 'close') {
    errors.push(`${prefix}: gates are not allowed on ${phase} stages`)
  }
  if (!isRecord(value)) {
    errors.push(`${prefix}: must be an object`)
    return
  }
  const position = value.position
  if (position !== 'before' && position !== 'after') {
    errors.push(`${prefix}.position: must be "before" or "after"`)
  }
  if (value.kind !== 'human') {
    errors.push(`${prefix}.kind: must be "human"`)
  }
  return {
    position: position === 'before' ? 'before' : 'after',
    kind: 'human',
  }
}

function validateInstructions(value: unknown, prefix: string, errors: string[]): string {
  if (!nonEmptyString(value)) {
    errors.push(`${prefix}: must be a non-empty string`)
    return ''
  }
  const matches = value.matchAll(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g)
  for (const match of matches) {
    if (!TEMPLATE_VARIABLES.has(match[1])) {
      errors.push(`${prefix}: unknown template variable {{${match[1]}}}`)
    }
  }
  return value
}

function validateProgressGuard(value: unknown, errors: string[]): ProgressGuard | undefined {
  if (value === undefined) return
  if (!isRecord(value)) {
    errors.push('progressGuard: must be an object')
    return
  }
  if (!nonEmptyString(value.metric)) {
    errors.push('progressGuard.metric: must be a non-empty string')
    return
  }
  if (
    value.samples !== undefined &&
    (typeof value.samples !== 'number' ||
      !Number.isInteger(value.samples) ||
      value.samples < 2 ||
      value.samples > 10)
  ) {
    errors.push('progressGuard.samples: must be an integer between 2 and 10')
  }
  return {
    metric: value.metric,
    ...(typeof value.samples === 'number' ? { samples: value.samples } : {}),
  }
}

export function validatePipeline(value: unknown): PipelineValidation {
  const errors: string[] = []
  if (!isRecord(value)) return { errors: ['pipeline: must be a JSON object'] }

  if (value.schemaVersion !== PIPELINE_SCHEMA_VERSION) {
    errors.push(`schemaVersion: must be ${PIPELINE_SCHEMA_VERSION}`)
  }
  if (!nonEmptyString(value.id) || !/^[a-z0-9][a-z0-9-]*$/.test(value.id)) {
    errors.push('id: must be lowercase letters, digits, and dashes')
  }
  if (!nonEmptyString(value.name)) errors.push('name: must be a non-empty string')
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) {
    errors.push('version: must be a positive integer')
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    errors.push('description: must be a string')
  }
  const progressGuard = validateProgressGuard(value.progressGuard, errors)
  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    errors.push('stages: must be a non-empty array')
    return { errors }
  }

  const stages: PipelineStage[] = []
  const ids = new Set<string>()
  const priorEvidence = new Set<string>()
  let contractCount = 0
  let closeCount = 0

  value.stages.forEach((raw, index) => {
    const prefix = `stages[${index}]`
    if (!isRecord(raw)) {
      errors.push(`${prefix}: must be an object`)
      return
    }
    if (!nonEmptyString(raw.id)) {
      errors.push(`${prefix}.id: must be a non-empty string`)
      return
    }
    const id = raw.id
    if (ids.has(id)) errors.push(`${prefix}.id: duplicate stage id "${id}"`)
    ids.add(id)
    if (!nonEmptyString(raw.title)) errors.push(`${prefix}.title: must be a non-empty string`)
    if (!isPhase(raw.phase)) {
      errors.push(`${prefix}.phase: must be one of ${STAGE_PHASES.join(', ')}`)
      return
    }
    const phase = raw.phase
    if (!nonEmptyString(raw.agent)) errors.push(`${prefix}.agent: must be a non-empty string`)
    if (!isRole(raw.role)) {
      errors.push(`${prefix}.role: must be one of ${STAGE_ROLES.join(', ')}`)
      return
    }
    if (phase === 'close' && raw.role !== 'closer') {
      errors.push(`${prefix}.role: close stages must use role "closer"`)
    }
    if (phase !== 'close' && raw.role !== 'worker') {
      errors.push(`${prefix}.role: ${phase} stages must use role "worker"`)
    }
    if (phase === 'contract') contractCount++
    if (phase === 'close') closeCount++

    const evidence = validateEvidence(raw.evidence, `${prefix}.evidence`, errors)
    if (phase === 'close' && raw.when !== undefined) {
      errors.push(`${prefix}.when: the close stage cannot be conditional`)
    }
    const when =
      raw.when === undefined
        ? undefined
        : validateCondition(raw.when, `${prefix}.when`, priorEvidence, errors)
    if (evidence) {
      for (const key of Object.keys(evidence)) priorEvidence.add(key)
    }
    const gate = validateGate(raw.gate, `${prefix}.gate`, phase, errors)
    const instructions = validateInstructions(raw.instructions, `${prefix}.instructions`, errors)

    stages.push({
      id,
      title: typeof raw.title === 'string' ? raw.title : '',
      phase,
      agent: typeof raw.agent === 'string' ? raw.agent : '',
      role: raw.role,
      instructions,
      ...(evidence && Object.keys(evidence).length > 0 ? { evidence } : {}),
      ...(when ? { when } : {}),
      ...(gate ? { gate } : {}),
    })
  })

  if (contractCount !== 1) errors.push('stages: exactly one contract stage is required')
  if (closeCount !== 1) errors.push('stages: exactly one close stage is required')
  if (stages.length && stages[0].phase !== 'contract') {
    errors.push('stages[0].phase: the contract stage must be first')
  }
  if (stages.length && stages[stages.length - 1].phase !== 'close') {
    errors.push(`stages[${stages.length - 1}].phase: the close stage must be last`)
  }

  if (errors.length) return { errors }
  return {
    errors: [],
    pipeline: {
      schemaVersion: PIPELINE_SCHEMA_VERSION,
      id: value.id as string,
      name: value.name as string,
      version: value.version as number,
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
      ...(progressGuard ? { progressGuard } : {}),
      stages,
    },
  }
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

export function readPipelineFile(path: string): PipelineValidation & { rawId?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { errors: [`${path}: ${(error as Error).message}`] }
  }
  const rawId = isRecord(parsed) && typeof parsed.id === 'string' ? parsed.id : undefined
  const validation = validatePipeline(parsed)
  return { ...validation, rawId }
}

export function catalogPipelines(dir: string = pipelineDir()): {
  pipelines: LoadedPipeline[]
  errors: PipelineLoadError[]
} {
  const byId = new Map<string, LoadedPipeline>()
  const errors: PipelineLoadError[] = []

  const builtin = validatePipeline(SOFTWARE_PIPELINE)
  if (builtin.pipeline) {
    byId.set(builtin.pipeline.id, { pipeline: builtin.pipeline, source: 'builtin' })
  } else {
    errors.push({ id: SOFTWARE_PIPELINE_ID, errors: builtin.errors })
  }

  if (!existsSync(dir)) return { pipelines: [...byId.values()], errors }

  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()

  for (const file of files) {
    const path = join(dir, file)
    const result = readPipelineFile(path)
    if (!result.pipeline) {
      errors.push({ path, id: result.rawId, errors: result.errors })
      continue
    }
    const existing = byId.get(result.pipeline.id)
    if (existing && existing.source === 'file') {
      errors.push({
        path,
        id: result.pipeline.id,
        errors: [`${path}: duplicate pipeline id "${result.pipeline.id}"`],
      })
      continue
    }
    byId.set(result.pipeline.id, { pipeline: result.pipeline, source: 'file', path })
  }

  return { pipelines: [...byId.values()], errors }
}

export function loadPipeline(id: string, dir: string = pipelineDir()): LoadedPipeline {
  const catalog = catalogPipelines(dir)
  const found = catalog.pipelines.find((item) => item.pipeline.id === id)
  if (found) return found
  const errors = catalog.errors.filter((error) => error.id === id)
  if (errors.length) {
    throw new Error(
      `Clara: invalid pipeline "${id}": ${errors.flatMap((error) => error.errors).join('; ')}`
    )
  }
  const available = catalog.pipelines.map((item) => item.pipeline.id).join(', ')
  throw new Error(`Clara: no pipeline "${id}". Available: ${available || 'none'}`)
}

// ---------------------------------------------------------------------------
// hashing, conditions, templates
// ---------------------------------------------------------------------------

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

export function renderInstructions(
  stage: PipelineStage,
  pipeline: Pipeline,
  request: Row,
  workspace: Row
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

// ---------------------------------------------------------------------------
// ledger integration
// ---------------------------------------------------------------------------

/** Pin existing rows that predate pipeline snapshots. Idempotent. */
export function ensurePipelineSnapshots(db: Db): void {
  const snapshot = pipelineSnapshot(SOFTWARE_PIPELINE)
  const hash = pipelineHash(SOFTWARE_PIPELINE)
  db.prepare(
    `UPDATE requests
        SET pipeline_id = COALESCE(pipeline_id, ?),
            pipeline_version = COALESCE(pipeline_version, ?),
            pipeline_hash = COALESCE(pipeline_hash, ?),
            pipeline_snapshot = COALESCE(pipeline_snapshot, ?)
      WHERE pipeline_snapshot IS NULL`
  ).run(SOFTWARE_PIPELINE.id, SOFTWARE_PIPELINE.version, hash, snapshot)
}

export function pipelineForRequest(db: Db, request: Row): Pipeline {
  if (typeof request.pipeline_snapshot === 'string' && request.pipeline_snapshot.trim()) {
    return parsePipelineSnapshot(request.pipeline_snapshot)
  }
  ensurePipelineSnapshots(db)
  return SOFTWARE_PIPELINE
}

export function selectWorkspacePipeline(db: Db, workspace: string, id: string): string {
  const loaded = loadPipeline(id)
  const row = db.prepare('SELECT * FROM workspaces WHERE name = ?').get(workspace)
  if (!row) throw new Error(`Clara: no workspace "${workspace}"`)
  db.prepare('UPDATE workspaces SET pipeline_id = ?, pipeline_version = ? WHERE id = ?').run(
    loaded.pipeline.id,
    loaded.pipeline.version,
    row.id
  )
  return `${workspace}: pipeline ${loaded.pipeline.id}@${loaded.pipeline.version}`
}

export function workspacePipelineId(workspace: Row): string {
  return typeof workspace.pipeline_id === 'string' && workspace.pipeline_id.trim()
    ? workspace.pipeline_id
    : SOFTWARE_PIPELINE_ID
}
