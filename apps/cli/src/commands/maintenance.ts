import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { isCompiled } from '../self.ts'
import { resolvePaths } from '../paths.ts'
import { resolvePorts } from '../ports.ts'
import { defaultServices, statusStack } from '../service/lifecycle.ts'
import { stopStack } from '../service/stop.ts'
import { adapterHubLinks } from '../adapters/hubs.ts'
import { adapterListReport } from './adapters.ts'
import { detectRole, roleLabel } from '../state/role.ts'
import { serviceInstallGuard } from './role-guard.ts'
import { releaseBaseUrl } from '../release/manifest.ts'
import { desktopStatus, readDesktopInstallInfo, uninstallDesktop } from '../release/desktop.ts'
import {
  defaultBinDir,
  installInfoPath,
  installsDir,
  readInstallInfo,
} from '../release/version-store.ts'
import {
  applyPlan,
  detectService,
  installPlan,
  printService,
  serviceState,
  uninstallPlan,
  type ServiceOptions,
} from '../service-manager/index.ts'
import { bold, dim } from '../ui/color.ts'
import { failure, success, warn } from '../ui/index.ts'
import { confirm } from '../ui/prompt.ts'
import { version } from '../version.ts'
import { parseFlags } from './flags.ts'

export function runServiceCommand(args: readonly string[]): number {
  const parsed = parseFlags(args)
  const action = parsed.positionals[0] ?? 'status'
  if (action === 'install') {
    const guard = serviceInstallGuard(detectRole(resolvePaths()))
    if (guard) {
      console.error(guard)
      return 1
    }
  }
  const kind = detectService()
  const options = serviceOptions()

  if (action === 'print') {
    console.log(printService(kind, options))
    return 0
  }
  if (action === 'status') {
    const state = serviceState(kind, options)
    console.log(`${bold('login service')}  ${state.kind}`)
    console.log(`installed  ${state.installed ? 'yes' : 'no'}`)
    console.log(`active     ${state.active ? 'yes' : 'no'}`)
    return 0
  }
  if (action === 'install') {
    if (!isCompiled() && !parsed.flags.has('force')) {
      console.error(failure('Install the packaged binary before adding a login service.'))
      return 1
    }
    const result = applyPlan(installPlan(kind, options))
    for (const line of result.actions) console.log(dim(line))
    if (result.errors.length > 0) {
      console.error(failure(result.errors.join('; ')))
      return 1
    }
    console.log(success(`Installed the ${kind} login service.`))
    return 0
  }
  if (action === 'uninstall') {
    const result = applyPlan(uninstallPlan(kind, options))
    for (const line of result.actions) console.log(dim(line))
    if (result.errors.length > 0) {
      console.error(failure(result.errors.join('; ')))
      return 1
    }
    console.log(success(`Removed the ${kind} login service.`))
    return 0
  }
  console.error(`unknown service action: ${action}`)
  return 2
}

export async function runUninstallCommand(args: readonly string[]): Promise<number> {
  const parsed = parseFlags(args)
  const paths = resolvePaths()
  if (!parsed.flags.has('yes')) {
    const ok = await confirm(
      'Stop Clara, remove the login service, and uninstall the command?',
      false
    )
    if (!ok) return 1
  }

  await stopStack(paths, undefined)
  if (readDesktopInstallInfo(paths.configDir)) {
    try {
      uninstallDesktop({
        configDir: paths.configDir,
        dataDir: paths.dataDir,
        binDir: defaultBinDir(),
        purge: parsed.flags.has('purge'),
        log: (line) => console.log(dim(line)),
      })
    } catch (cause) {
      console.log(
        warn(
          `The desktop app was not removed: ${cause instanceof Error ? cause.message : String(cause)}`
        )
      )
    }
  }
  const kind = detectService()
  applyPlan(uninstallPlan(kind, serviceOptions()))
  const link = join(defaultBinDir(), process.platform === 'win32' ? 'clara.exe' : 'clara')
  if (process.platform !== 'win32' || link !== process.execPath) rmSync(link, { force: true })
  try {
    rmSync(installsDir(paths), { recursive: true, force: true })
  } catch {
    console.log(dim('Left the running version in place.'))
  }
  rmSync(installInfoPath(paths), { force: true })
  if (!isCompiled()) console.log(dim('Source checkout left in place.'))

  if (parsed.flags.has('purge')) {
    for (const directory of [paths.configDir, paths.dataDir, paths.cacheDir]) {
      rmSync(directory, { recursive: true, force: true })
      console.log(dim(`removed ${directory}`))
    }
  }
  console.log(success('Clara was uninstalled.'))
  return 0
}

export async function runDoctorCommand(): Promise<number> {
  const paths = resolvePaths()
  const ports = resolvePorts()
  const role = detectRole(paths)
  const current = readInstallInfo(paths)
  console.log(bold(`Clara ${version()}`))
  console.log(`role         ${roleLabel(role)}`)
  console.log(`command      ${process.execPath}`)
  console.log(`config       ${paths.configDir}`)
  console.log(`data         ${paths.dataDir}`)
  console.log(`cache        ${paths.cacheDir}`)
  console.log(`release      ${releaseBaseUrl()}`)
  console.log(`login        ${detectService()}`)
  console.log(`installed    ${current?.version ?? 'source checkout'}`)
  const desktop = desktopStatus(paths.configDir)
  console.log(
    `desktop      ${desktop.installed ? `Clara Desktop ${desktop.version}` : 'not installed'}`
  )

  if (role === 'adapter') {
    const hubs = adapterHubLinks(adapterListReport(paths))
    if (hubs.length === 0) {
      console.log('hub          no adapter connection reported yet')
    }
    for (const hub of hubs) {
      console.log(`hub link     ${hub.url} ${hub.status}`)
      if (hub.endpoints.web) console.log(`hub web      ${hub.endpoints.web}`)
      if (hub.endpoints.hub) console.log(`hub api      ${hub.endpoints.hub}`)
      if (hub.endpoints.engine) console.log(`hub engine   ${hub.endpoints.engine}`)
    }
    return 0
  }

  const state = await statusStack(paths, ports, defaultServices())
  for (const service of state.services) {
    console.log(`service      ${service.name} ${service.state} ${service.url}`)
  }
  return 0
}

function serviceOptions(): ServiceOptions {
  const paths = resolvePaths()
  return {
    homeDir: process.env.HOME ?? homedir(),
    configDir: paths.configDir,
    dataDir: paths.dataDir,
    cacheDir: paths.cacheDir,
    logDir: paths.logDir,
    execPath: process.execPath,
  }
}
