import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestPath, readManifest, writeManifest, type RunnerManifest } from './manifest.ts'
import { runnerConfigPath, writeRunnerConfig } from './config.ts'
import { installService, removeService, serviceActive } from './service.ts'

export interface RunnerInstallInput {
  workspace?: string
  url?: string
  concurrency?: number
  labels?: string[]
  noService?: boolean
  dryRun?: boolean
  explicit?: boolean
}

export interface RunnerInstallResult {
  manifest: RunnerManifest
  actions: string[]
  warnings: string[]
}

/** The CLI entry used by the generated user service. */
export function runnerEntry(): string {
  const candidates = [
    fileURLToPath(new URL('./cli.js', import.meta.url)),
    fileURLToPath(new URL('./cli.ts', import.meta.url)),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('The Clara runner entry is missing. Build @clara/runner and retry.')
}

/** Install the one shared script runner used by every harness in a workspace. */
export function installRunner(input: RunnerInstallInput = {}): RunnerInstallResult {
  const workspace = resolve(
    input.workspace ??
      process.env.CLARA_ENGINE_WORKSPACE?.trim() ??
      process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ??
      process.cwd()
  )
  const url = (
    input.url ??
    process.env.CLARA_ENGINE_URL?.trim() ??
    process.env.CLARA_ORCHESTRATION_URL?.trim() ??
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
  const actions: string[] = []
  const warnings: string[] = []
  const runner: RunnerManifest = {
    url,
    workspace,
    concurrency: input.concurrency ?? 2,
    labels: input.labels ?? [],
    service: 'none',
    explicit: input.explicit ?? false,
    installedAt: Date.now(),
  }
  if (!input.dryRun) {
    writeRunnerConfig(runnerConfigPath(), {
      url,
      workspace,
      concurrency: runner.concurrency,
      labels: runner.labels,
    })
  }
  actions.push(`write runner config ${runnerConfigPath()}`)
  if (input.noService) {
    actions.push(`runner service skipped; run: clara-runner --config ${runnerConfigPath()}`)
  } else {
    const service = installService({
      entry: runnerEntry(),
      configPath: runnerConfigPath(),
      dryRun: input.dryRun,
    })
    runner.service = service.service
    if (service.unitPath) runner.unitPath = service.unitPath
    actions.push(...service.actions)
    if (service.warning) warnings.push(service.warning)
  }
  if (!input.dryRun) {
    const path = manifestPath()
    const manifest = readManifest(path)
    writeManifest(path, { ...manifest, runner })
  }
  return { manifest: runner, actions, warnings }
}

export function uninstallRunner(input: { dryRun?: boolean } = {}): string[] {
  const actions: string[] = []
  const path = manifestPath()
  const manifest = readManifest(path)
  if (manifest.runner) {
    if (!input.dryRun) removeService(manifest.runner.service, manifest.runner.unitPath)
    const config = runnerConfigPath()
    if (existsSync(config)) {
      if (!input.dryRun) unlinkSync(config)
      actions.push(`remove runner config ${config}`)
    }
    delete manifest.runner
  }
  if (!input.dryRun) {
    if (!manifest.runner) {
      if (existsSync(path)) unlinkSync(path)
    } else {
      writeManifest(path, manifest)
    }
  }
  return actions
}

export interface RunnerInstallStatus {
  config: string
  present: boolean
  service: string
  active: string
}

export function runnerStatus(): RunnerInstallStatus | undefined {
  const manifest = readManifest()
  if (!manifest.runner) return undefined
  return {
    config: runnerConfigPath(),
    present: existsSync(runnerConfigPath()),
    service: manifest.runner.service,
    active:
      manifest.runner.service === 'none' ? 'foreground' : serviceActive(manifest.runner.service),
  }
}
