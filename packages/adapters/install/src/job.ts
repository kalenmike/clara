import { randomUUID } from 'node:crypto'
import type {
  AdapterInstallJob,
  AdapterInstallJobState,
  AdapterInstallMethod,
  InstallRunner,
} from './types.ts'
import { runProcess } from './runner.ts'

const JOB_TTL_MS = 30 * 60_000
const JOB_TIMEOUT_MS = 10 * 60_000
const MAX_JOBS = 20
const MAX_LINES = 400
const MAX_LINE_LENGTH = 2_000

export type InstallJobServiceOptions = {
  runner?: InstallRunner
  now?: () => number
  timeoutMs?: number
  ttlMs?: number
  maxJobs?: number
}

type JobRecord = {
  job: AdapterInstallJob
  controller: AbortController
  timer?: NodeJS.Timeout
  reason?: 'user' | 'timeout' | 'shutdown'
}

/**
 * One adapter install at a time on the machine that runs the client. The hub
 * issues the pairing code; this service only executes the checksummed script
 * and reports the log.
 */
export class InstallJobService {
  private readonly runner: InstallRunner
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly ttlMs: number
  private readonly maxJobs: number
  private readonly jobs = new Map<string, JobRecord>()

  constructor(options: InstallJobServiceOptions = {}) {
    this.runner = options.runner ?? runProcess
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? JOB_TIMEOUT_MS
    this.ttlMs = options.ttlMs ?? JOB_TTL_MS
    this.maxJobs = options.maxJobs ?? MAX_JOBS
  }

  start(input: {
    kind: string
    method: AdapterInstallMethod
    target: string
    command: string
    args: string[]
  }): AdapterInstallJob {
    this.prune()
    const record = this.createRecord(input)
    this.jobs.set(record.job.id, record)
    void this.execute(record, input.command, input.args)
    return snapshot(record)
  }

  job(id: string): AdapterInstallJob | undefined {
    const record = this.jobs.get(id)
    return record ? snapshot(record) : undefined
  }

  cancel(id: string): boolean {
    const record = this.jobs.get(id)
    if (!record || record.job.state !== 'running') return false
    record.reason = 'user'
    record.controller.abort()
    return true
  }

  cancelAll(): void {
    for (const record of this.jobs.values()) {
      if (record.job.state !== 'running') continue
      record.reason = 'shutdown'
      record.controller.abort()
    }
  }

  close(): void {
    this.cancelAll()
  }

  private async execute(record: JobRecord, command: string, args: string[]): Promise<void> {
    try {
      const result = await this.runner(
        command,
        args,
        (line) => this.append(record, line),
        record.controller.signal
      )
      if (record.reason === 'timeout') {
        this.finish(record, 'failed', 'The adapter install timed out.')
      } else if (record.reason === 'user' || record.reason === 'shutdown') {
        this.finish(record, 'cancelled', 'The adapter install was cancelled.')
      } else if (result.exitCode === 0) {
        this.append(record, 'Adapter installed and connected.')
        this.finish(record, 'succeeded')
      } else {
        const code = result.exitCode ?? result.signal ?? 'unknown'
        this.finish(record, 'failed', `The adapter install exited with ${code}.`)
      }
    } catch (cause) {
      if (record.reason === 'timeout') {
        this.finish(record, 'failed', 'The adapter install timed out.')
      } else if (record.reason === 'user' || record.reason === 'shutdown') {
        this.finish(record, 'cancelled', 'The adapter install was cancelled.')
      } else {
        this.finish(record, 'failed', errorMessage(cause))
      }
    }
  }

  private createRecord(input: {
    kind: string
    method: AdapterInstallMethod
    target: string
  }): JobRecord {
    const id = randomUUID()
    const startedAt = new Date(this.now()).toISOString()
    const job: AdapterInstallJob = {
      id,
      kind: input.kind,
      method: input.method,
      target: input.target,
      state: 'running',
      startedAt,
      lines: [
        `Installing ${input.kind} on ${input.target}.`,
        'Downloading and verifying the adapter install script…',
      ],
    }
    const record: JobRecord = { job, controller: new AbortController() }
    record.timer = setTimeout(() => {
      record.reason = 'timeout'
      record.controller.abort()
    }, this.timeoutMs)
    record.timer.unref?.()
    return record
  }

  private finish(
    record: JobRecord,
    state: Exclude<AdapterInstallJobState, 'running'>,
    error?: string
  ) {
    if (record.timer) clearTimeout(record.timer)
    record.timer = undefined
    if (record.job.state !== 'running') return
    record.job.state = state
    record.job.finishedAt = new Date(this.now()).toISOString()
    if (error) record.job.error = truncate(error)
    if (error) this.append(record, error)
  }

  private append(record: JobRecord, line: string): void {
    const text = truncate(line.replace(/\r$/, ''))
    if (!text.trim()) return
    record.job.lines.push(text)
    if (record.job.lines.length > MAX_LINES) {
      record.job.lines.splice(0, record.job.lines.length - MAX_LINES)
    }
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs
    for (const [id, record] of this.jobs) {
      if (record.job.state === 'running') continue
      const finished = record.job.finishedAt ? Date.parse(record.job.finishedAt) : 0
      if (finished < cutoff) this.jobs.delete(id)
    }
    if (this.jobs.size <= this.maxJobs) return
    const finished = [...this.jobs.entries()]
      .filter(([, record]) => record.job.state !== 'running')
      .sort((left, right) => left[1].job.startedAt.localeCompare(right[1].job.startedAt))
    for (const [id] of finished.slice(0, Math.max(0, this.jobs.size - this.maxJobs))) {
      this.jobs.delete(id)
    }
  }
}

function snapshot(record: JobRecord): AdapterInstallJob {
  return { ...record.job, lines: [...record.job.lines] }
}

function truncate(value: string): string {
  const text = value.trimEnd()
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH - 3)}...` : text
}

function errorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}
