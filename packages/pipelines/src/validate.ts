import {
  EVIDENCE_TYPES,
  PIPELINE_SCHEMA_VERSION,
  STAGE_PHASES,
  STAGE_ROLES,
  type EvidenceSpec,
  type EvidenceType,
  type Pipeline,
  type PipelineStage,
  type ProgressGuard,
  type StageCondition,
  type StageGate,
  type StagePhase,
  type StageRole,
} from '@clara/shared-types'

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
