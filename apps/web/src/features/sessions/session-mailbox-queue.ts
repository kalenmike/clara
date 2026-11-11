/**
 * Each mailbox lookup fans out to three message/form requests. The sidebar
 * starts one lookup per session, so without a shared ceiling a large project
 * can exceed the hub's per-session request limit.
 */
export const MAILBOX_SIGNAL_CONCURRENCY = 4

let active = 0
const waiting: Array<() => void> = []

function acquire(): Promise<void> {
  if (active < MAILBOX_SIGNAL_CONCURRENCY) {
    active += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) {
    next()
    return
  }
  active = Math.max(0, active - 1)
}

/** Run one session's mailbox lookup within the shared request budget. */
export async function withMailboxSignalSlot<T>(task: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await task()
  } finally {
    release()
  }
}
