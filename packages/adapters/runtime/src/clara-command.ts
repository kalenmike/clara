import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { isAdapterVersion } from '@clara/adapter-artifact'
import {
  compareVersions,
  defaultBinDir,
  installsDir,
  installLatest,
  readInstallInfo,
  resolvePaths,
  versionBinary,
} from '@clara/release'

export type ClaraBinary = {
  command: string
  version?: string
  source: 'explicit' | 'install' | 'path'
}

export type ClaraCommandOptions = {
  /** The adapter kind, used in help and error text. */
  name: string
  /** The adapter's own status output when the full CLI is not installed. */
  nativeStatus: () => Promise<void> | void
  env?: NodeJS.ProcessEnv
  containerized?: boolean
}

/**
 * `clara-adapter-<kind> clara <command...>` runs the real Clara command. It
 * downloads and verifies the signed CLI release once when the machine has only
 * an adapter, so no service code is bundled into the adapter binary.
 */
export async function runClaraCommand(
  options: ClaraCommandOptions,
  args: readonly string[]
): Promise<void> {
  const env = options.env ?? process.env
  const [sub = ''] = args
  const resolved = resolveClaraBinary(env)
  const help = sub === 'help' || sub === '--help' || sub === '-h'

  if (!resolved) {
    if (sub === 'status') {
      await options.nativeStatus()
      printInstallHint(options.name)
      return
    }
    if (sub === '' || help) {
      printHelp(options.name)
      return
    }
    if (options.containerized) {
      throw new Error(
        'This adapter runs in a container. Install Clara on the host and run the command there.'
      )
    }
    console.error(`Downloading the Clara command for ${sub}...`)
    const result = await installLatest({
      paths: resolvePaths(env),
      binDir: defaultBinDir(env),
      fallbackVersion: '0.0.0',
    })
    console.log(`Installed Clara ${result.version} at ${result.binary}`)
    if (sub === 'install' || sub === 'update') return
    await spawnClara(result.binary, args, env)
    return
  }

  if (sub === 'install') {
    console.log(
      `Clara ${resolved.version ?? '(installed)'} is already installed at ${resolved.command}`
    )
    return
  }
  if (sub === '' || help) {
    if (sub === '') printHelp(options.name)
    else await spawnClara(resolved.command, args, env)
    return
  }
  await spawnClara(resolved.command, args, env)
}

/** Find a real Clara command without downloading it. */
export function resolveClaraBinary(env = process.env): ClaraBinary | undefined {
  const explicit = env.CLARA_BIN?.trim()
  if (explicit) {
    if (!existsSync(explicit))
      throw new Error(`CLARA_BIN points at ${explicit}, which does not exist.`)
    return { command: explicit, source: 'explicit' }
  }

  const paths = resolvePaths(env)
  const installed = readInstallInfo(paths)
  const recorded =
    installed && existsSync(versionBinary(paths, installed.version))
      ? {
          command: versionBinary(paths, installed.version),
          version: installed.version,
          source: 'install' as const,
        }
      : undefined
  const newest = newestInstall(paths)
  if (
    recorded &&
    recorded.version &&
    (!newest?.version || compareVersions(recorded.version, newest.version) >= 0)
  ) {
    return recorded
  }
  if (newest) return newest

  const onPath = findOnPath(env)
  if (onPath) return { command: onPath, source: 'path' }
  return undefined
}

function newestInstall(paths: ReturnType<typeof resolvePaths>): ClaraBinary | undefined {
  let best: ClaraBinary | undefined
  const root = installsDir(paths)
  if (!existsSync(root)) return undefined
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isAdapterVersion(entry.name)) continue
      const binary = versionBinary(paths, entry.name)
      if (!existsSync(binary)) continue
      if (!best?.version || compareVersions(entry.name, best.version) > 0) {
        best = { command: binary, version: entry.name, source: 'install' }
      }
    }
  } catch {
    return best
  }
  return best
}

function findOnPath(env: NodeJS.ProcessEnv): string | undefined {
  const path = env.PATH || env.Path
  if (!path) return undefined
  const names =
    process.platform === 'win32' ? ['clara.exe', 'clara.cmd', 'clara.bat', 'clara'] : ['clara']
  for (const directory of path.split(delimiter)) {
    if (!directory) continue
    for (const name of names) {
      const candidate = join(directory, name)
      if (!existsSync(candidate)) continue
      if (process.platform !== 'win32') {
        try {
          accessSync(candidate, constants.X_OK)
        } catch {
          continue
        }
      }
      return candidate
    }
  }
  return undefined
}

function spawnClara(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: 'inherit',
      env,
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      process.exitCode = signal ? 1 : (code ?? 1)
      resolve()
    })
  })
}

function printHelp(name: string): void {
  console.log(`Clara command for the ${name} adapter

Usage:
  clara-adapter-${name} clara <command...>

The Clara command is not installed on this machine. Run:
  clara-adapter-${name} clara install

Then commands such as \`clara status\`, \`clara update\`, \`clara start\`, and
\`clara setup\` work here. \`clara-adapter-${name} clara status\` shows this
adapter's status without downloading anything.`)
}

function printInstallHint(name: string): void {
  console.log('')
  console.log('The full Clara command is not installed on this machine.')
  console.log(`Install it with: clara-adapter-${name} clara install`)
}
