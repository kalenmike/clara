import { ClaraApiError } from '@clara/api-client'
import type { ClaraSessionMessage } from '@clara/api-contract'
import type { SessionMailboxSignals } from '@clara/shared-types'
import { assistantHasFailed } from '@/features/chat/message-visibility'
import { isFinishedPlanReply } from '@/features/chat/plan-ready'
import type { ClaraClient } from '@/lib/client'

/**
 * Sessions per request; the hub rejects a larger batch. A sidebar lists at
 * most fifty, so a normal load fits in one frame.
 */
export const SESSION_SIGNAL_BATCH_SIZE = 100

/** Let one render's queries collect before flushing them as one request. */
const BATCH_DELAY_MS = 12

type Waiter = {
  sessionID: string
  updated: number
  signal: AbortSignal | undefined
  resolve: (signals: SessionMailboxSignals | null) => void
  reject: (cause: unknown) => void
  cleanup: () => void
}

type ClientBatch = {
  waiters: Waiter[]
  timer: number | null
}

const batches = new WeakMap<ClaraClient, ClientBatch>()

/**
 * Load one session's mailbox signals through a shared batch. The sidebar starts
 * a lookup per listed session; coalescing them into one request keeps the relay
 * frame budget free for the screen the person is actually looking at.
 *
 * A session the hub cannot resolve settles as `null`, which the sidebar
 * already treats as its historical Inbox fallback.
 */
export function loadSessionMailboxSignals(
  client: ClaraClient,
  sessionID: string,
  updated: number,
  signal?: AbortSignal
): Promise<SessionMailboxSignals | null> {
  if (signal?.aborted) return Promise.reject(abortError())

  const batch = batches.get(client) ?? { waiters: [], timer: null }
  batches.set(client, batch)

  return new Promise<SessionMailboxSignals | null>((resolve, reject) => {
    const onAbort = () => {
      const index = batch.waiters.indexOf(waiter)
      if (index >= 0) batch.waiters.splice(index, 1)
      reject(abortError())
    }
    const waiter: Waiter = {
      sessionID,
      updated,
      signal,
      resolve,
      reject,
      cleanup: () => signal?.removeEventListener('abort', onAbort),
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    batch.waiters.push(waiter)

    if (batch.timer === null) {
      batch.timer = window.setTimeout(() => flush(client, batch), BATCH_DELAY_MS)
    }
  })
}

function flush(client: ClaraClient, batch: ClientBatch): void {
  batch.timer = null
  const waiters = batch.waiters.splice(0)
  batches.delete(client)
  for (let offset = 0; offset < waiters.length; offset += SESSION_SIGNAL_BATCH_SIZE) {
    void send(client, waiters.slice(offset, offset + SESSION_SIGNAL_BATCH_SIZE))
  }
}

async function send(client: ClaraClient, waiters: Waiter[]): Promise<void> {
  // A query removed before the flush must not join a request.
  const live = waiters.filter((waiter) => !waiter.signal?.aborted)
  if (live.length === 0) return

  const controller = new AbortController()
  let active = live.length
  for (const waiter of live) {
    waiter.signal?.addEventListener(
      'abort',
      () => {
        active -= 1
        if (active === 0) controller.abort()
      },
      { once: true }
    )
  }

  try {
    const response = await client.session.signals(
      {
        sessions: live.map((waiter) => ({
          sessionID: waiter.sessionID,
          updated: waiter.updated,
        })),
      },
      { signal: controller.signal }
    )
    const bySession = new Map(
      response.data.map((entry) => [entry.sessionID, entry.signals] as const)
    )
    for (const waiter of live) {
      if (waiter.signal?.aborted) continue
      waiter.cleanup()
      waiter.resolve(bySession.get(waiter.sessionID) ?? null)
    }
  } catch (cause) {
    // A web build can reach a hub that predates the batch route. Keep the old
    // per-session reads working until the hub updates.
    if (cause instanceof ClaraApiError && cause.status === 404 && cause.code === 'not_found') {
      for (const waiter of live) {
        if (waiter.signal?.aborted) continue
        void loadSignalsIndividually(client, waiter)
      }
      return
    }
    for (const waiter of live) {
      if (waiter.signal?.aborted) continue
      waiter.cleanup()
      waiter.reject(cause)
    }
  }
}

/** The pre-batch lookup, used only when the hub has no batch endpoint. */
async function loadSignalsIndividually(client: ClaraClient, waiter: Waiter): Promise<void> {
  try {
    const [users, assistants, forms] = await Promise.all([
      client.message.list(
        { sessionID: waiter.sessionID, order: 'desc', limit: 1, type: 'user' },
        { signal: waiter.signal }
      ),
      client.message.list(
        { sessionID: waiter.sessionID, order: 'desc', limit: 1, type: 'assistant' },
        { signal: waiter.signal }
      ),
      client.session.form
        .list({ sessionID: waiter.sessionID }, { signal: waiter.signal })
        .catch(() => []),
    ])
    waiter.cleanup()
    waiter.resolve(signalsFromLatest(users.data[0], assistants.data[0], forms.length > 0))
  } catch (cause) {
    waiter.cleanup()
    waiter.reject(cause)
  }
}

function signalsFromLatest(
  lastUser: ClaraSessionMessage | undefined,
  lastAssistant: ClaraSessionMessage | undefined,
  awaitingInput: boolean
): SessionMailboxSignals {
  const last: SessionMailboxSignals['last'] =
    !lastUser && !lastAssistant
      ? 'none'
      : lastAssistant && (!lastUser || lastAssistant.time.created >= lastUser.time.created)
        ? 'assistant'
        : 'user'
  const assistantLast =
    last === 'assistant' && lastAssistant?.type === 'assistant' ? lastAssistant : undefined
  return {
    last,
    awaitingInput,
    lastError: Boolean(assistantLast && assistantHasFailed(assistantLast)),
    planReply: Boolean(assistantLast && isFinishedPlanReply(assistantLast)),
  }
}

function abortError(): DOMException {
  return new DOMException('The request was aborted', 'AbortError')
}
