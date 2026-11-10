// Worker prompt composition and per-session tool scoping for the Clara
// OpenCode adapter.
//
// The orchestrator owns the work order: it carries the pinned step prompt, the
// declared input results, the artifact paths, and the root request. The adapter
// turns that into one model prompt and hides tools the step does not own.

export const NAMESPACE = 'clara'

const ROUTER_TOOLS = new Set([`${NAMESPACE}_route`, `${NAMESPACE}_fail`])
const TASK_TOOLS = new Set([`${NAMESPACE}_complete`, `${NAMESPACE}_fail`, `${NAMESPACE}_spawn`])
// Code Mode is a transport for tools, not a tool a step owns. Never delete its
// gateway while scoping: a model that is told to use `execute` will otherwise
// emit the call as text because the gateway is missing.
const GATEWAY_TOOLS = new Set(['execute', 'search'])

export interface PromptInput {
  label?: string
  path?: string
  name?: string
  result?: unknown
}

export interface PromptArtifact {
  label?: string
  path?: string
  exists?: boolean
}

export interface PromptFailure {
  step?: string
  attempt?: number
  error?: string
  result?: unknown
}

export interface PromptWork {
  step_path?: string
  kind?: string
  prompt?: string
  /** Set false to omit the root request reference from this step. */
  request?: boolean
  retry?: {
    attempt?: number
    error?: string
    result?: unknown
  }
  context?: {
    prompt?: string
    inputs?: PromptInput[]
    artifacts?: PromptArtifact[]
    failure?: PromptFailure
  }
}

export interface ScopedWork {
  kind?: string
  routes?: Array<{ when?: string }>
  managed?: boolean
}

export type ToolRecord = Record<string, unknown>

export function toolName(name: string): string {
  return `${NAMESPACE}_${name}`
}

// The step prompt already carries the rendered route list, so the adapter must
// not append it again. A step gets exactly the inputs it declares, its artifact
// paths, and the request as background. Nothing else is pushed.
export function renderWorkPrompt(work: PromptWork): string {
  const sections: string[] = []
  const step = typeof work.prompt === 'string' ? work.prompt.trim() : ''
  if (step) sections.push(step)

  const request = typeof work.context?.prompt === 'string' ? work.context.prompt.trim() : ''
  const router = work.kind === 'router'

  // A router classifies the request, so it is primary input there rather than
  // background scope.
  if (router && request) sections.push(`# Request\n\n${request}`)

  const inputs = renderInputs(work.context?.inputs)
  if (inputs) sections.push(`# Inputs\n\n${inputs}`)

  const artifacts = renderArtifacts(work.context?.artifacts)
  if (artifacts) {
    sections.push(
      `# Artifacts\n\nRead these from the workspace when you need them.\n\n${artifacts}`
    )
  }

  const failure = renderFailure(work.context?.failure)
  if (failure) sections.push(`# Failure being recovered\n\n${failure}`)

  const previous = renderPreviousAttempt(work.retry)
  if (previous) sections.push(`# Previous attempt\n\n${previous}`)

  if (!router && request && work.request !== false) {
    sections.push(`# Reference: original request\n\n${REFERENCE_NOTE}\n\n${request}`)
  }

  sections.push(finishInstruction(work.kind))
  return sections.filter(Boolean).join('\n\n---\n\n')
}

const REFERENCE_NOTE =
  'Background scope only. The task above is authoritative. Do not restate this request, re-plan it, or treat it as a second instruction. Use it only to keep the work aligned with what the human asked for.'

function renderInputs(inputs: PromptInput[] | undefined): string {
  if (!Array.isArray(inputs)) return ''
  return inputs
    .map((input) => {
      const result = renderResult(input.result)
      if (!result) return ''
      const label = typeof input.label === 'string' ? input.label : ''
      const name = typeof input.name === 'string' ? input.name : ''
      const heading = label === name ? label : [label, name].filter(Boolean).join(' — ')
      return `### ${heading || 'Input'}\n\n${result}`
    })
    .filter(Boolean)
    .join('\n\n')
}

function renderArtifacts(artifacts: PromptArtifact[] | undefined): string {
  if (!Array.isArray(artifacts)) return ''
  return artifacts
    .flatMap((artifact) => {
      if (typeof artifact?.path !== 'string' || !artifact.path) return []
      const label =
        typeof artifact.label === 'string' && artifact.label && artifact.label !== artifact.path
          ? `${artifact.label} — `
          : ''
      const missing = artifact.exists === false ? ' (missing)' : ''
      return [`- ${label}\`${artifact.path}\`${missing}`]
    })
    .join('\n')
}

function renderPreviousAttempt(retry: PromptWork['retry']): string {
  if (!retry) return ''
  const attempt = typeof retry.attempt === 'number' ? retry.attempt : 1
  const error = typeof retry.error === 'string' ? retry.error.trim() : ''
  const result = renderResult(retry.result)
  if (!error && !result) return ''
  const lines = [`Attempt ${attempt} ended before the step finished.`]
  if (error) lines.push(error)
  if (result) lines.push(`What it produced:\n\n${clip(result, 4_000)}`)
  lines.push('Build on this. Do not repeat the same investigation unless it is wrong.')
  return lines.join('\n\n')
}

function renderFailure(failure: PromptFailure | undefined): string {
  if (!failure || typeof failure !== 'object') return ''
  const step = typeof failure.step === 'string' ? failure.step : ''
  const attempt = typeof failure.attempt === 'number' ? failure.attempt : 1
  const error = typeof failure.error === 'string' ? failure.error.trim() : ''
  const result = renderResult(failure.result)
  if (!step && !error && !result) return ''
  const lines = [
    step
      ? `${step} failed on attempt ${attempt}; this step is its recovery branch.`
      : `The step failed on attempt ${attempt}; this step is its recovery branch.`,
  ]
  if (error) lines.push(error)
  if (result) lines.push(`What it produced:\n\n${clip(result, 4_000)}`)
  lines.push(
    'Work only on recovery. Do not re-plan the pipeline, and do not repeat the failed work unless the recovery requires it.'
  )
  return lines.join('\n\n')
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… truncated` : text
}

function renderResult(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value.trim()
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function finishInstruction(kind: string | undefined): string {
  if (kind === 'router') {
    return 'Call `clara_route` with the route you chose. If you cannot choose a route, call `clara_fail` with a short reason.'
  }
  return 'When the step is complete, call `clara_complete` with the result. If you are blocked, call `clara_fail` with a short reason.'
}

// Managed workers only see the control tools they need. Routers see the route
// and fail tools and nothing else. Tasks keep their repository tools but lose
// the orchestration tools that belong to the human-facing Clara agent.
export function scopeWorkerTools(tools: ToolRecord | undefined, work: ScopedWork): void {
  if (!tools || !work.managed) return
  if (work.kind === 'router') {
    for (const name of Object.keys(tools)) {
      if (GATEWAY_TOOLS.has(name)) continue
      if (!ROUTER_TOOLS.has(name)) delete tools[name]
    }
    applyRouteSchema(tools, work.routes)
    return
  }
  for (const name of Object.keys(tools)) {
    if (GATEWAY_TOOLS.has(name)) continue
    if (name.startsWith(`${NAMESPACE}_`) && !TASK_TOOLS.has(name)) delete tools[name]
  }
}

function applyRouteSchema(tools: ToolRecord, routes: ScopedWork['routes']): void {
  const name = toolName('route')
  const current = tools[name]
  if (!current || typeof current !== 'object') return
  const keys = (routes ?? []).flatMap((route) =>
    typeof route?.when === 'string' && route.when ? [route.when] : []
  )
  if (!keys.length) return
  tools[name] = {
    ...(current as Record<string, unknown>),
    input: {
      type: 'object',
      properties: {
        route: {
          type: 'string',
          enum: keys,
          description: 'The route key to choose.',
        },
      },
      required: ['route'],
      additionalProperties: false,
    },
  }
}
