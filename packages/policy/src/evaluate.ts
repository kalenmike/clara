import { budgetExceeded, remainingBudget } from './budget.ts'
import { matches, matchesAny } from './match.ts'
import type { EffectiveBudget, PolicyCheck, PolicyDecision, StepPolicy, Usage } from './types.ts'

// The Clara control tools are how a worker reports a result, routes a step, or
// asks to fail. They must stay usable after a budget is exhausted; otherwise a
// blocked worker cannot finish or fail cleanly and the step deadlocks.
const CONTROL_TOOLS = new Set([
  'clara_complete',
  'clara_fail',
  'clara_route',
  'clara_spawn',
  'clara.complete',
  'clara.fail',
  'clara.route',
  'clara.spawn',
  'complete',
  'fail',
  'route',
  'spawn',
])

export function isControlTool(tool: string | undefined): boolean {
  return Boolean(tool && CONTROL_TOOLS.has(tool))
}

function ruleDecision(
  policy: StepPolicy,
  check: PolicyCheck
): { effect: 'allow' | 'deny' | 'ask'; reason?: string } | undefined {
  if (!policy.rules?.length) return undefined
  const resources = check.resources?.length ? check.resources : ['']
  let result: { effect: 'allow' | 'deny' | 'ask'; reason?: string } | undefined
  for (const resource of resources) {
    for (const rule of policy.rules) {
      const actionMatches = matches(check.action, rule.action) || rule.action === '*'
      const resourceMatches = matches(resource, rule.resource) || rule.resource === '*'
      if (actionMatches && resourceMatches) {
        result = {
          effect: rule.effect,
          reason: rule.effect === 'deny' ? `${rule.action} ${rule.resource} is denied` : undefined,
        }
      }
    }
  }
  return result
}

export function evaluatePolicy(
  policy: StepPolicy | undefined,
  budget: EffectiveBudget,
  usage: Usage,
  check: PolicyCheck
): PolicyDecision {
  const remaining = remainingBudget(budget, usage)
  const exceeded = budgetExceeded(budget, usage)
  if (exceeded && !isControlTool(check.tool)) {
    return { effect: 'deny', reason: exceeded, remaining }
  }

  if (!policy) return { effect: 'allow', remaining }

  if (policy.subagents === 'deny' && check.tool === 'task') {
    return { effect: 'deny', reason: 'subagents are disabled for this step', remaining }
  }

  const tool = check.tool ?? check.action
  if (policy.tools?.deny && matchesAny(tool, policy.tools.deny)) {
    return { effect: 'deny', reason: `tool ${tool} is denied`, remaining }
  }
  if (
    policy.tools?.allow &&
    policy.tools.allow.length > 0 &&
    !matchesAny(tool, policy.tools.allow)
  ) {
    return { effect: 'deny', reason: `tool ${tool} is not allowed`, remaining }
  }

  const resources = check.resources ?? []
  if (
    policy.edit &&
    (check.action === 'edit' || check.action === 'write' || check.action === 'patch')
  ) {
    for (const resource of resources) {
      if (policy.edit.deny && matchesAny(resource, policy.edit.deny)) {
        return { effect: 'deny', reason: `edit ${resource} is denied`, remaining }
      }
      if (
        policy.edit.allow &&
        policy.edit.allow.length > 0 &&
        !matchesAny(resource, policy.edit.allow)
      ) {
        return { effect: 'deny', reason: `edit ${resource} is not allowed`, remaining }
      }
    }
  }

  if (policy.shell && check.action === 'shell') {
    const command = check.command ?? resources.join(' ')
    if (policy.shell.deny && matchesAny(command, policy.shell.deny)) {
      return { effect: 'deny', reason: `shell command is denied`, remaining }
    }
    if (
      policy.shell.allow &&
      policy.shell.allow.length > 0 &&
      !matchesAny(command, policy.shell.allow)
    ) {
      return { effect: 'deny', reason: `shell command is not allowed`, remaining }
    }
  }

  if (policy.network && (check.action === 'network' || check.action === 'webfetch')) {
    const target = check.network ?? resources[0] ?? ''
    if (policy.network.deny && matchesAny(target, policy.network.deny)) {
      return { effect: 'deny', reason: `network target ${target} is denied`, remaining }
    }
    if (
      policy.network.allow &&
      policy.network.allow.length > 0 &&
      !matchesAny(target, policy.network.allow)
    ) {
      return { effect: 'deny', reason: `network target ${target} is not allowed`, remaining }
    }
  }

  const rule = ruleDecision(policy, check)
  if (rule) return { ...rule, remaining }

  return { effect: 'allow', remaining }
}

export function violated(decision: PolicyDecision): boolean {
  return decision.effect === 'deny'
}
