import { existsSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { HarnessName, Options } from './args.ts'
import { INSTALLABLE, UsageError } from './args.ts'
import { genericMcpConfig } from './mcp-config.ts'
import {
  claraConfigDir,
  manifestPath,
  readManifest,
  writeManifest,
  type InstallManifest,
  type RunnerManifest,
} from './manifest.ts'
import { cliEntry, mcpEntryPath, openCodeAdapterDaemonEntry } from './package-paths.ts'
import { runnerConfigPath, writeRunnerConfig } from './runner-config.ts'
import { installService, removeService, serviceActive } from './service.ts'
import { installOpenCode, openCodeStatus, uninstallOpenCode } from './harnesses/opencode.ts'
import { installOpenCodeAdapter, uninstallOpenCodeAdapter } from '@clara/adapter-opencode/install'
import {
  adapterProcessStatus,
  startAdapterProcess,
  stopAdapterProcess,
  tailAdapterLog,
} from '@clara/adapter-opencode/service'
import { adapterConfigPath, readConfig } from '@clara/adapter-opencode/config'

export interface InstallResult {
  manifest: InstallManifest
  actions: string[]
  warnings: string[]
  genericMcp?: string
}

function workspaceFor(options: Options): string {
  return resolve(
    options.workspace ?? process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ?? process.cwd()
  )
}

function urlFor(options: Options): string {
  return (
    options.url ??
    process.env.CLARA_ORCHESTRATION_URL?.trim() ??
    'http://127.0.0.1:8789'
  ).replace(/\/$/, '')
}

function assertSupported(selected: HarnessName[]): void {
  const unsupported = selected.filter((name) => !INSTALLABLE.includes(name))
  if (unsupported.length) {
    throw new UsageError(
      `the ${unsupported.join(', ')} adapter is not available yet; only opencode can be installed`
    )
  }
}

export async function install(options: Options): Promise<InstallResult> {
  const selected = options.harnesses
  const wantsRunner = options.runner || (selected.length > 0 && !options.noRunner)
  if (!selected.length && !wantsRunner && !options.mcp) {
    throw new UsageError('select a harness with --opencode, --runner, or --mcp')
  }
  if (options.mcpFor.length && !selected.length) {
    throw new UsageError('--mcp-for needs a selected harness')
  }
  const unknownMcp = options.mcpFor.filter((name) => !selected.includes(name))
  if (unknownMcp.length) {
    throw new UsageError(`--mcp-for ${unknownMcp.join(', ')} was not selected`)
  }
  assertSupported(selected)

  const path = manifestPath()
  const previous = readManifest(path)
  const manifest: InstallManifest = {
    ...previous,
    harnesses: { ...previous.harnesses },
  }
  const actions: string[] = []
  const warnings: string[] = []
  const workspace = workspaceFor(options)
  const url = urlFor(options)
  const mcpHarnesses = options.mcp ? selected : options.mcpFor
  const needsMcpEntry = options.mcp || mcpHarnesses.length > 0
  const entry = needsMcpEntry ? mcpEntryPath() : undefined
  const mcpEntry = needsMcpEntry && entry ? { command: [process.execPath, entry], url } : undefined

  if (!selected.length && options.mcp && !wantsRunner && entry) {
    return {
      manifest,
      actions,
      warnings,
      genericMcp: genericMcpConfig(entry, url),
    }
  }

  for (const name of selected) {
    if (name !== 'opencode') continue
    if (!options.noDaemon) {
      const daemon = await installOpenCodeAdapter({
        ...(options.pair ? { pair: options.pair } : {}),
        ...(options.opencodeUrl ? { opencodeUrl: options.opencodeUrl } : {}),
        ...(options.opencodeUsername ? { opencodeUsername: options.opencodeUsername } : {}),
        ...(options.opencodePassword ? { opencodePassword: options.opencodePassword } : {}),
        noService: options.noService,
        dryRun: options.dryRun,
        entry: openCodeAdapterDaemonEntry(),
      })
      actions.push(...daemon.actions)
      warnings.push(...daemon.warnings)
    }
    const result = installOpenCode({
      force: options.force,
      mcp: mcpHarnesses.includes('opencode'),
      url,
      ...(mcpEntry ? { mcpEntry } : {}),
      dryRun: options.dryRun,
    })
    manifest.harnesses.opencode = result.manifest
    actions.push(...result.actions)
  }

  if (wantsRunner) {
    const runner: RunnerManifest = {
      url,
      workspace,
      concurrency: options.concurrency ?? 2,
      labels: options.labels,
      service: 'none',
      explicit: options.runner && selected.length === 0,
      installedAt: Date.now(),
    }
    if (!options.dryRun) {
      writeRunnerConfig(runnerConfigPath(), {
        url,
        workspace,
        concurrency: runner.concurrency,
        labels: runner.labels,
      })
    }
    actions.push(`write runner config ${runnerConfigPath()}`)
    if (options.noService) {
      actions.push(
        `runner service skipped; run: clara-adapter runner --config ${runnerConfigPath()}`
      )
    } else {
      const service = installService({
        entry: cliEntry(),
        configPath: runnerConfigPath(),
        dryRun: options.dryRun,
      })
      runner.service = service.service
      if (service.unitPath) runner.unitPath = service.unitPath
      actions.push(...service.actions)
      if (service.warning) warnings.push(service.warning)
    }
    manifest.runner = runner
  }

  if (!options.dryRun) writeManifest(path, manifest)
  return {
    manifest,
    actions,
    warnings,
    ...(!selected.length && options.mcp && entry
      ? { genericMcp: genericMcpConfig(entry, url) }
      : {}),
  }
}

export interface UninstallResult {
  manifest: InstallManifest
  actions: string[]
  warnings: string[]
}

export function uninstall(options: Options): UninstallResult {
  if (options.harnesses.length === 0 && options.mcp) {
    throw new UsageError('uninstall does not take --mcp; use --opencode or --runner')
  }
  const path = manifestPath()
  const manifest = readManifest(path)
  const all = options.harnesses.length === 0 && !options.runner
  const targets: HarnessName[] = all
    ? (Object.keys(manifest.harnesses) as HarnessName[])
    : options.harnesses
  const actions: string[] = []
  const warnings: string[] = []

  for (const name of targets) {
    if (name !== 'opencode') {
      warnings.push(`${name} is not installed by this build`)
      continue
    }
    actions.push(...uninstallOpenCode({ force: options.force, dryRun: options.dryRun }))
    if (!options.noDaemon && !options.dryRun) {
      actions.push(...uninstallOpenCodeAdapter({ purge: options.purge }))
    }
    delete manifest.harnesses[name]
  }

  const remaining = Object.keys(manifest.harnesses).length
  const removeRunner =
    Boolean(manifest.runner) &&
    (all || options.runner || (!remaining && !manifest.runner?.explicit))
  if (removeRunner && manifest.runner) {
    if (!options.dryRun) removeService(manifest.runner.service, manifest.runner.unitPath)
    const config = runnerConfigPath()
    if (existsSync(config)) {
      if (!options.dryRun) unlinkSync(config)
      actions.push(`remove runner config ${config}`)
    }
    delete manifest.runner
  }

  if (!options.dryRun) {
    if (Object.keys(manifest.harnesses).length === 0 && !manifest.runner) {
      if (existsSync(path)) unlinkSync(path)
    } else {
      writeManifest(path, manifest)
    }
  }
  return { manifest, actions, warnings }
}

export interface StatusReport {
  manifest: InstallManifest
  harnesses: Record<string, ReturnType<typeof openCodeStatus>>
  runner?: {
    config: string
    present: boolean
    service: string
    active: string
  }
  orchestrator: 'running' | 'stopped'
  adapter?: {
    config: string
    present: boolean
    running: boolean
    pid?: number
    log: string
    harnessId?: string
    wsUrl?: string
    opencodeUrl?: string
  }
}

export async function status(): Promise<StatusReport> {
  const manifest = readManifest()
  const harnesses: Record<string, ReturnType<typeof openCodeStatus>> = {}
  if (manifest.harnesses.opencode) harnesses.opencode = openCodeStatus()
  const runnerPath = runnerConfigPath()
  const adapter = readConfig()
  const adapterProcess = adapterProcessStatus()
  const orchestrator: 'running' | 'stopped' = await fetch(
    `${manifest.runner?.url ?? process.env.CLARA_ORCHESTRATION_URL ?? 'http://127.0.0.1:8789'}/health`,
    { signal: AbortSignal.timeout(1_500) }
  )
    .then((response): 'running' | 'stopped' => (response.ok ? 'running' : 'stopped'))
    .catch((): 'stopped' => 'stopped')
  return {
    manifest,
    harnesses,
    ...(manifest.runner
      ? {
          runner: {
            config: runnerPath,
            present: existsSync(runnerPath),
            service: manifest.runner.service,
            active:
              manifest.runner.service === 'none'
                ? 'foreground'
                : serviceActive(manifest.runner.service),
          },
        }
      : {}),
    orchestrator,
    adapter: {
      config: adapterConfigPath(),
      present: adapter !== undefined,
      running: adapterProcess.running,
      ...(adapterProcess.pid !== undefined ? { pid: adapterProcess.pid } : {}),
      log: adapterProcess.log,
      ...(adapter
        ? { harnessId: adapter.harnessId, wsUrl: adapter.wsUrl, opencodeUrl: adapter.opencode.url }
        : {}),
    },
  }
}

// Keep the config dir referenced here so status paths stay consistent with the
// installer even when callers only read the manifest.
export function configDirectory(): string {
  return claraConfigDir()
}

export function startAdapter(): string[] {
  return startAdapterProcess(openCodeAdapterDaemonEntry()).actions
}

export function stopAdapter(): string[] {
  return stopAdapterProcess()
}

export function adapterLogs(lines = 80): string {
  return tailAdapterLog(lines)
}
