import type { ClaraSessionMessage } from '@clara/api-contract'
import { readClaraEvent } from './system-events'

/** Stop waiting after this many assistant messages and tool calls. */
export const PLAN_REQUEST_MAX_UNITS = 5

export type PlanRequest = {
  id: string
  time: number
}

export type PlanRequestProgress = 'waiting' | 'responded' | 'timed-out'

/** The newest plan request Clara wrote to the transcript. */
export function findLatestPlanRequest(messages: ClaraSessionMessage[]): PlanRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.type !== 'synthetic') continue

    const event = readClaraEvent(message)
    if (event?.kind !== 'plan-request' && event?.kind !== 'plan-update') continue
    return { id: message.id, time: message.time.created }
  }

  return undefined
}

/**
 * A plan request is answered by a `todowrite` call. When the agent keeps
 * working without one, give up after five assistant messages or tool calls so
 * the person can ask again. A locally created request that is not in the
 * transcript yet falls back to its creation time.
 */
export function planRequestProgress(
  messages: ClaraSessionMessage[],
  request: PlanRequest
): PlanRequestProgress {
  const requestIndex = messages.findIndex((message) => message.id === request.id)
  const start = requestIndex >= 0 ? requestIndex + 1 : 0
  let units = 0

  for (let index = start; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.type !== 'assistant') continue
    if (requestIndex < 0 && message.time.created < request.time) continue

    for (const part of message.content) {
      if (part.type !== 'tool') continue
      if (requestIndex < 0 && (part.time?.created ?? message.time.created) < request.time) {
        continue
      }
      if (part.name === 'todowrite') return 'responded'
      units += 1
      if (units >= PLAN_REQUEST_MAX_UNITS) return 'timed-out'
    }

    units += 1
    if (units >= PLAN_REQUEST_MAX_UNITS) return 'timed-out'
  }

  return 'waiting'
}
