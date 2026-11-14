import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  PanelInstallDockerTargets,
  PanelInstallHostInput,
  PanelInstallInfo,
  PanelInstallJob,
  PanelInstallMethod,
  PanelHarnessPairing,
  PanelInstallSshTargets,
} from '@clara/shared-types'
import type { ServerConfig } from '../config.ts'
import { PanelControlError } from './controls.ts'
import {
  buildInstallScript,
  dockerInvocation,
  sshInvocation,
  validateDockerTarget,
  validateKind,
  validateOpencodeUrl,
  validateSshTarget,
} from './install-command.ts'
import { InstallRegistry, type ResolvedInstallManifest } from './install-registry.ts'
import { listDockerTargets, listSshTargets, type RunCommand } from './install-targets.ts'

const JOB_TTL_MS = 30 * 60_000
const JOB_TIMEOUT_MS = 10 * 60_000
const MAX_JOBS = 20
const MAX_LINES = 400
const MAX_LINE_LENGTH = 2_000
const KILL_GRACE_MS = 3_000

export type InstallRunResult = {
  exitCode: number | null
  signal?: NodeJS.Signals | null
}

export type InstallRunner = (
  command: string,
  args: string[],
  onLine: (line: string) => void,
  signal: AbortSignal
) => Promise<InstallRunResult>

export type InstallServiceOptions = {
  config: ServerConfig
  registry: InstallRegistry
  isEnabled: () => boolean
  isContainerized: () => boolean
  allowRemote: () => boolean
  log: (message: string, detail?: unknown) => void
  sshTargets?: () => Promise<PanelInstallSshTargets>
  dockerTargets?: () => Promise<PanelInstallDockerTargets>
  runCommand?: RunCommand
  runner?: InstallRunner
  now?: () => number
  timeoutMs?: number
}

type JobRecord = {
  job: PanelInstallJob
  controller: AbortController
  timer?: NodeJS.Timeout
  reason?: 'user' | 'timeout' | 'shutdown'
}

/**
 * Runs one adapter install script at a time on a target the owner selected.
 * The hub never downloads the adapter; the target runs the registry script.
 */
export class InstallService {
  private readonly options: InstallServiceOptions
  private readonly registry: InstallRegistry
  private readonly runner: InstallRunner
  private readonly now: () => number
  private readonly sshTargets: () => Promise<PanelInstallSshTargets>
  private readonly dockerTargets: () => Promise<PanelInstallDockerTargets>
  private readonly timeoutMs: number
  private readonly jobs = new Map<string, JobRecord>()

  constructor(options: InstallServiceOptions) {
    this.options = options
    this.registry = options.registry
    this.runner = options.runner ?? runProcess
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? JOB_TIMEOUT_MS
    this.sshTargets = options.sshTargets ?? (() => listSshTargets({ run: options.runCommand }))
    this.dockerTargets =
      options.dockerTargets ?? (() => listDockerTargets({ run: options.runCommand }))
  }

  async info(force = false): Promise<PanelInstallInfo> {
    this.prune()
    const enabled = this.options.isEnabled()
    const reason = this.unavailableReason()
    const registry = await this.registry.info(force)
    if (reason) {
      return {
        enabled,
        available: false,
        reason,
        registry,
        ssh: { available: false, reason, hosts: [] },
        docker: { available: false, reason, containers: [] },
      }
    }
    const [ssh, docker] = await Promise.all([this.sshTargets(), this.dockerTargets()])
    return { enabled, available: true, registry, ssh, docker }
  }

  async manifest(kind: string, force = false): Promise<ResolvedInstallManifest> {
    return this.registry.resolved(validateKind(kind), force)
  }

  /**
   * The pairing transport follows from where the adapter runs. SSH always needs
   * the relay; a container needs the Docker network only when the hub is itself
   * a container.
   */
  transportFor(method: PanelInstallMethod): 'docker' | 'relay' {
    if (method === 'ssh') {
      if (!relayUsable(this.options.config.relay)) {
        throw new PanelControlError(
          400,
          'relay_required',
          'Configure the relay before installing an adapter over SSH. A remote host cannot reach the hub loopback listener.'
        )
      }
      return 'relay'
    }
    if (this.options.isContainerized()) return 'docker'
    if (!relayUsable(this.options.config.relay)) {
      throw new PanelControlError(
        400,
        'relay_required',
        'Configure the relay before installing an adapter in a container. The container cannot reach the hub loopback listener.'
      )
    }
    return 'relay'
  }

  async start(input: {
    kind: string
    method: PanelInstallMethod
    host?: PanelInstallHostInput
    container?: string
    opencodeUrl?: string
    pairing: PanelHarnessPairing
  }): Promise<PanelInstallJob> {
    if (!this.options.isEnabled()) {
      throw new PanelControlError(
        403,
        'install_disabled',
        'Adapter installs are off. Turn them on in Settings → Adapter downloads.'
      )
    }
    const unavailable = this.unavailableReason()
    if (unavailable) {
      throw new PanelControlError(403, 'install_unavailable', unavailable)
    }

    const kind = validateKind(input.kind)
    const method = input.method
    if (method !== 'ssh' && method !== 'docker') {
      throw new PanelControlError(400, 'invalid_method', 'Choose SSH or Docker')
    }
    const opencodeUrl = validateOpencodeUrl(input.opencodeUrl)
    const resolved = await this.manifest(kind)

    let command: string
    let args: string[]
    let target: string
    if (method === 'ssh') {
      const ssh = await this.resolveSshTarget(input.host)
      const script = buildInstallScript({
        kind,
        manifest: resolved.manifest,
        installUrl: resolved.installUrl,
        pairingCode: input.pairing.code,
        ...(opencodeUrl ? { opencodeUrl } : {}),
      })
      command = 'ssh'
      args = sshInvocation(ssh, script)
      target = ssh.label
    } else {
      const docker = await this.resolveDockerTarget(input.container)
      const script = buildInstallScript({
        kind,
        manifest: resolved.manifest,
        installUrl: resolved.installUrl,
        pairingCode: input.pairing.code,
        ...(opencodeUrl ? { opencodeUrl } : {}),
      })
      command = 'docker'
      args = dockerInvocation(docker, script)
      target = docker.label
    }

    this.prune()
    const record = this.createRecord({
      kind,
      method,
      target,
      pairingId: input.pairing.id,
      version: resolved.manifest.version,
    })
    this.jobs.set(record.job.id, record)
    void this.execute(record, command, args)
    return snapshot(record)
  }

  job(id: string): PanelInstallJob | undefined {
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
        this.append(record, 'Adapter installed. Waiting for it to connect…')
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
    method: PanelInstallMethod
    target: string
    pairingId: string
    version: string
  }): JobRecord {
    const id = randomUUID()
    const startedAt = new Date(this.now()).toISOString()
    const job: PanelInstallJob = {
      id,
      pairingId: input.pairingId,
      kind: input.kind,
      method: input.method,
      target: input.target,
      state: 'running',
      startedAt,
      lines: [
        `Installing ${input.kind} ${input.version} on ${input.target}.`,
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

  private finish(record: JobRecord, state: 'succeeded' | 'failed' | 'cancelled', error?: string) {
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

  private async resolveSshTarget(input: PanelInstallHostInput | undefined) {
    const target = validateSshTarget(input)
    if (!target.alias) return target
    const targets = await this.sshTargets()
    if (!targets.available) {
      throw new PanelControlError(
        400,
        'ssh_unavailable',
        targets.reason ?? 'SSH is not available on the hub host.'
      )
    }
    if (!targets.hosts.some((host) => host.alias === target.alias)) {
      throw new PanelControlError(
        400,
        'unknown_ssh_host',
        'That host is not in the hub host SSH configuration. Enter it manually.'
      )
    }
    return target
  }

  private async resolveDockerTarget(value: unknown) {
    const target = validateDockerTarget(value)
    const targets = await this.dockerTargets()
    if (!targets.available) {
      throw new PanelControlError(
        400,
        'docker_unavailable',
        targets.reason ?? 'Docker is not available on the hub host.'
      )
    }
    const match = targets.containers.find(
      (container) => container.name === target.container || container.id === target.container
    )
    if (!match) {
      throw new PanelControlError(
        400,
        'unknown_container',
        'That container is not running on the hub host. Refresh the list and try again.'
      )
    }
    return { container: match.name, label: match.name }
  }

  private unavailableReason(): string | undefined {
    if (!this.options.isEnabled()) {
      return 'Adapter installs are off. Turn them on in Settings → Adapter downloads.'
    }
    if (this.options.allowRemote()) {
      return 'The panel is reachable beyond loopback, so install actions are disabled.'
    }
    if (this.options.isContainerized()) {
      return 'The hub service runs in Docker. Install from a local hub, or use Manual.'
    }
    return undefined
  }

  private prune(): void {
    const cutoff = this.now() - JOB_TTL_MS
    for (const [id, record] of this.jobs) {
      if (record.job.state === 'running') continue
      const finished = record.job.finishedAt ? Date.parse(record.job.finishedAt) : 0
      if (finished < cutoff) this.jobs.delete(id)
    }
    if (this.jobs.size <= MAX_JOBS) return
    const finished = [...this.jobs.entries()]
      .filter(([, record]) => record.job.state !== 'running')
      .sort((left, right) => left[1].job.startedAt.localeCompare(right[1].job.startedAt))
    for (const [id] of finished.slice(0, Math.max(0, this.jobs.size - MAX_JOBS))) {
      this.jobs.delete(id)
    }
  }
}

function snapshot(record: JobRecord): PanelInstallJob {
  return { ...record.job, lines: [...record.job.lines] }
}

function relayUsable(relay: ServerConfig['relay']): boolean {
  return Boolean(relay?.url && relay.agentToken)
}

function truncate(value: string): string {
  const text = value.trimEnd()
  return text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH - 3)}...` : text
}

function errorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.length > 240 ? `${text.slice(0, 237)}...` : text
}

/** Spawn a command, forward complete output lines, and honor cancellation. */
function runProcess(
  command: string,
  args: string[],
  onLine: (line: string) => void,
  signal: AbortSignal
): Promise<InstallRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false

    const flush = (current: string, final: boolean): string => {
      let remaining = current
      let index = remaining.indexOf('\n')
      while (index >= 0) {
        onLine(remaining.slice(0, index))
        remaining = remaining.slice(index + 1)
        index = remaining.indexOf('\n')
      }
      if (final && remaining) {
        onLine(remaining)
        remaining = ''
      }
      return remaining
    }

    const kill = () => {
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS)
      timer.unref?.()
    }
    const onAbort = () => kill()
    signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = flush(stdout + chunk.toString('utf8'), false)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = flush(stderr + chunk.toString('utf8'), false)
    })
    child.on('error', (cause) => {
      if (settled) return
      settled = true
      cleanup()
      reject(cause)
    })
    child.on('close', (code, closeSignal) => {
      if (settled) return
      settled = true
      cleanup()
      flush(stdout, true)
      flush(stderr, true)
      resolve({ exitCode: code, signal: closeSignal })
    })
  })
}
