// Worker prompt composition and per-session tool scoping for the Clara
// OpenCode adapter.
//
// The orchestrator owns the work order: it carries the pinned step prompt, the
// root request, and the results of completed steps. The adapter turns that into
// one model prompt and hides tools the step does not own.

export const NAMESPACE = 'clara'

const ROUTER_TOOLS = new Set([`${NAMESPACE}_route`, `${NAMESPACE}_fail`])
const TASK_TOOLS = new Set([`${NAMESPACE}_complete`, `${NAMESPACE}_fail`, `${NAMESPACE}_spawn`])
// Code Mode is a transport for tools, not a tool a step owns. Never delete its
// gateway while scoping: a model that is told to use `execute` will otherwise
// emit the call as text because the gateway is missing.
const GATEWAY_TOOLS = new Set(['execute', 'search'])

export interface PromptStepResult {
  path?: string
  name?: string
  result?: unknown
}

export interface PromptWork {
  step_path?: string
  kind?: string
  prompt?: string
  retry?: {
    attempt?: number
    error?: string
    result?: unknown
  }
  context?: {
    prompt?: string
    steps?: PromptStepResult[]
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
// not append it again. It only adds the root request and prior step results.
export function renderWorkPrompt(work: PromptWork): string {
  const sections: string[] = []
  const step = typeof work.prompt === 'string' ? work.prompt.trim() : ''
  if (step) sections.push(step)

  const request = typeof work.context?.prompt === 'string' ? work.context.prompt.trim() : ''
  if (request) sections.push(`# Request\n\n${request}`)

  const prior = renderPriorResults(work.context?.steps, work.step_path)
  if (prior) sections.push(`# Prior results\n\n${prior}`)

  const previous = renderPreviousAttempt(work.retry)
  if (previous) sections.push(`# Previous attempt\n\n${previous}`)

  sections.push(finishInstruction(work.kind))
  return sections.filter(Boolean).join('\n\n---\n\n')
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

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n… truncated` : text
}

function renderPriorResults(
  steps: PromptStepResult[] | undefined,
  current: string | undefined
): string {
  if (!Array.isArray(steps)) return ''
  return steps
    .filter((step) => step && step.path !== current)
    .map((step) => {
      const result = renderResult(step.result)
      if (!result) return ''
      const path = typeof step.path === 'string' ? step.path : ''
      const name = typeof step.name === 'string' ? step.name : ''
      const heading = [path, name].filter(Boolean).join(' — ')
      return `### ${heading || 'Prior step'}\n\n${result}`
    })
    .filter(Boolean)
    .join('\n\n')
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
