import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { autostartInstallPlan, autostartPath, autostartUninstallPlan } from './autostart.ts'
import { launchdInstallPlan, launchdStatus, launchdUninstallPlan } from './launchd.ts'
import { systemdInstallPlan, systemdStatus, systemdUninstallPlan } from './systemd.ts'
import {
  windowsCommand,
  windowsInstallPlan,
  windowsStatus,
  windowsUninstallPlan,
} from './windows.ts'
import type { ServiceAction, ServiceKind, ServiceOptions, ServicePlan } from './types.ts'

export type { ServiceKind, ServiceOptions } from './types.ts'

export type DetectInput = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  run?: (command: string, args: string[]) => number
}

export function detectService(input: DetectInput = {}): ServiceKind {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  const run = input.run ?? probe
  if (platform === 'darwin') return 'launchd'
  if (platform === 'win32') return 'task-scheduler'
  if (platform !== 'linux') return 'none'
  if (run('systemctl', ['--user', 'show-environment']) === 0) return 'systemd'
  if (env.XDG_CURRENT_DESKTOP || env.DISPLAY || env.WAYLAND_DISPLAY) return 'xdg-autostart'
  return 'none'
}

export function installPlan(kind: ServiceKind, options: ServiceOptions): ServicePlan {
  if (kind === 'systemd') return systemdInstallPlan(options)
  if (kind === 'launchd') return launchdInstallPlan(options)
  if (kind === 'task-scheduler') return windowsInstallPlan(options)
  if (kind === 'xdg-autostart') return autostartInstallPlan(options)
  throw new Error('This host has no supported login service; use `clara start`.')
}

export function uninstallPlan(kind: ServiceKind, options: ServiceOptions): ServicePlan {
  if (kind === 'systemd') return systemdUninstallPlan(options)
  if (kind === 'launchd') return launchdUninstallPlan(options)
  if (kind === 'task-scheduler') return windowsUninstallPlan()
  if (kind === 'xdg-autostart') return autostartUninstallPlan(options)
  return { writes: [], removals: [], actions: [] }
}

export type ServiceState = {
  kind: ServiceKind
  installed: boolean
  active: boolean
  detail?: string
}

export function serviceState(
  kind: ServiceKind,
  options: ServiceOptions,
  run: (command: string, args: string[]) => number = probe
): ServiceState {
  if (kind === 'none') return { kind, installed: false, active: false }
  if (kind === 'systemd' || kind === 'launchd' || kind === 'task-scheduler') {
    const command =
      kind === 'systemd' ? systemdStatus() : kind === 'launchd' ? launchdStatus() : windowsStatus()
    const status = run(command.command, command.args)
    return { kind, installed: status === 0, active: status === 0 }
  }
  const installed = existsSync(autostartPath(options))
  return { kind, installed, active: installed }
}

/** Apply a plan: write files, run actions, then remove old files. */
export function applyPlan(
  plan: ServicePlan,
  run: (action: ServiceAction) => number = runAction
): { actions: string[]; errors: string[] } {
  const actions: string[] = []
  const errors: string[] = []
  for (const write of plan.writes) {
    mkdirSync(dirname(write.path), { recursive: true, mode: 0o755 })
    writeFileSync(write.path, write.content, { mode: write.mode ?? 0o644 })
    actions.push(`wrote ${write.path}`)
  }
  for (const action of plan.actions) {
    const status = run(action)
    actions.push(`${action.command} ${action.args.join(' ')}`)
    if (status !== 0 && !action.allowFailure) {
      errors.push(`${action.command} exited ${status}`)
    }
  }
  for (const path of plan.removals) {
    rmSync(path, { force: true })
    actions.push(`removed ${path}`)
  }
  return { actions, errors }
}

export function printService(kind: ServiceKind, options: ServiceOptions): string {
  if (kind === 'systemd') return systemdInstallPlan(options).writes[0]?.content ?? ''
  if (kind === 'launchd') return launchdInstallPlan(options).writes[0]?.content ?? ''
  if (kind === 'xdg-autostart') return autostartInstallPlan(options).writes[0]?.content ?? ''
  if (kind === 'task-scheduler') return windowsCommand(options)
  return 'No supported login service on this host.'
}

function runAction(action: ServiceAction): number {
  const result = spawnSync(action.command, action.args, { encoding: 'utf8' })
  return result.status ?? 1
}

function probe(command: string, args: string[]): number {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 3_000 })
  return result.status ?? 1
}
