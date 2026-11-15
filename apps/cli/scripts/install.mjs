#!/usr/bin/env node
// Install an existing build of the packaged `clara` command into the current
// user's version store, or remove it again.
//
//   pnpm cli:install
//   pnpm cli:install --from <dir> --dry-run
//   pnpm cli:uninstall [--purge]
//
// The source is a build that already exists: `pnpm cli:build` writes
// `apps/cli/dist/package/<bun-target>/clara`. The script never builds. It uses
// the same layout as a release install — `<data>/versions/<version>/clara` with
// the user bin directory pointing at it and `install.json` under the config
// directory — so `clara doctor`, `clara update`, `clara update --rollback`, and
// `clara uninstall` treat the checkout build as a normal install.

import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const windows = process.platform === 'win32'
const binaryName = windows ? 'clara.exe' : 'clara'
const target = hostTarget()

const help = `Install the built Clara command for the current user.

Usage: pnpm cli:install [options]
       pnpm cli:uninstall [--purge]

Options:
  --from <file|dir>  Build to install (default: apps/cli/dist/package/${target}/${binaryName})
  --bin-dir <dir>    Directory for the clara link (default: ~/.local/bin)
  --dry-run          Print the plan without writing anything
  --uninstall        Remove the installed command
  --purge            With --uninstall, also remove config, data, and cache
  -h, --help         Show this help

The build must already exist. Run \`pnpm cli:build\` first. The installer writes
the same version store and install.json as a release install, so \`clara doctor\`,
\`clara update\`, and \`clara uninstall\` see the build.
`

function fail(message) {
  console.error(`cli install: ${message}`)
  process.exit(1)
}

function envPath(name) {
  const value = process.env[name]?.trim()
  return value ? resolve(value) : undefined
}

function expandHome(value) {
  return resolve(value.replace(/^~(?=$|\/|\\)/, homedir()))
}

function displayPath(path) {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function parseArgs(argv) {
  const options = {
    from: '',
    binDir: '',
    uninstall: false,
    purge: false,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[(index += 1)]
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value`)
      return next
    }

    switch (arg) {
      case '--from':
        options.from = value()
        break
      case '--bin-dir':
        options.binDir = value()
        break
      case '--uninstall':
        options.uninstall = true
        break
      case '--purge':
        options.purge = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '-h':
      case '--help':
        console.log(help)
        process.exit(0)
        break
      case '--':
        break
      default:
        fail(`unknown option ${arg}. Try --help.`)
    }
  }

  if (options.purge && !options.uninstall) fail('--purge only applies with --uninstall')
  return options
}

function hostTarget() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return `bun-darwin-${arch}`
  if (process.platform === 'win32') return `bun-windows-${arch}`
  return `bun-linux-${arch}`
}

function resolveSource(from) {
  if (from) {
    const candidate = expandHome(from)
    if (!existsSync(candidate)) fail(`--from ${candidate} does not exist`)
    const binary = statSync(candidate).isDirectory() ? join(candidate, binaryName) : candidate
    if (!existsSync(binary)) {
      fail(
        `${candidate} does not contain ${binaryName}. Run \`pnpm cli:build\`, ` +
          'or point --from at the executable.'
      )
    }
    return resolve(binary)
  }

  const built = join(root, 'apps', 'cli', 'dist', 'package', target, binaryName)
  if (existsSync(built)) return built
  fail(
    `no ${target} build in ${displayPath(dirname(built))}. ` +
      'Run `pnpm cli:build`, then install again.'
  )
}

function probeVersion(binary) {
  // The command extracts its embedded assets on startup. Keep the probe on
  // temporary directories so `--dry-run` really writes nothing for the user.
  const probeDir = mkdtempSync(join(tmpdir(), 'clara-install-probe-'))
  let result
  try {
    result = spawnSync(binary, ['--version'], {
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        ...process.env,
        CLARA_CONFIG_DIR: join(probeDir, 'config'),
        CLARA_DATA_DIR: join(probeDir, 'data'),
        CLARA_CACHE_DIR: join(probeDir, 'cache'),
      },
    })
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
  const output = (result.stdout ?? '').trim()
  if (result.error) {
    fail(
      `could not run ${displayPath(binary)}: ${result.error.message}. ` +
        'Build the command for this machine with `pnpm cli:build`.'
    )
  }
  if (result.status !== 0) {
    fail(
      `${displayPath(binary)} --version exited ${result.status}. ` +
        'Rebuild with `pnpm cli:build`.'
    )
  }
  const match = /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(output)
  if (!match) fail(`${displayPath(binary)} --version printed no version: ${output}`)
  return { version: match[1], line: output }
}

function resolvePaths(options) {
  const dataDir =
    envPath('CLARA_DATA_DIR') ??
    join(envPath('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share'), 'clara')
  const configDir =
    envPath('CLARA_CONFIG_DIR') ??
    join(envPath('XDG_CONFIG_HOME') ?? join(homedir(), '.config'), 'clara')
  const cacheDir =
    envPath('CLARA_CACHE_DIR') ??
    join(envPath('XDG_CACHE_HOME') ?? join(homedir(), '.cache'), 'clara')
  const binDir = options.binDir
    ? expandHome(options.binDir)
    : (envPath('CLARA_BIN_DIR') ?? defaultBinDir())

  return { dataDir, configDir, cacheDir, binDir }
}

function defaultBinDir() {
  if (windows) {
    const base = envPath('LOCALAPPDATA') ?? join(homedir(), 'AppData', 'Local')
    return join(base, 'Clara', 'bin')
  }
  return join(homedir(), '.local', 'bin')
}

function layoutPaths(paths) {
  const versionsDir = join(paths.dataDir, 'versions')
  return {
    ...paths,
    versionsDir,
    infoPath: join(paths.configDir, 'install.json'),
    linkPath: join(paths.binDir, binaryName),
  }
}

function versionBinary(paths, version) {
  return join(paths.versionsDir, version, binaryName)
}

function readInstallInfo(infoPath) {
  try {
    if (!existsSync(infoPath)) return undefined
    const value = JSON.parse(readFileSync(infoPath, 'utf8'))
    return value?.schemaVersion === 1 && typeof value.version === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

function installFile(source, destination, mode) {
  mkdirSync(dirname(destination), { recursive: true })
  const temp = `${destination}.${process.pid}.tmp`
  copyFileSync(source, temp)
  chmodSync(temp, mode)
  renameSync(temp, destination)
}

function writeFileAtomic(destination, content, mode) {
  mkdirSync(dirname(destination), { recursive: true })
  const temp = `${destination}.${process.pid}.tmp`
  writeFileSync(temp, content, { mode })
  renameSync(temp, destination)
}

function activateVersion(source, linkPath) {
  mkdirSync(dirname(linkPath), { recursive: true, mode: 0o755 })
  const temp = `${linkPath}.${process.pid}.tmp`
  rmSync(temp, { force: true })
  if (windows) {
    copyFileSync(source, temp)
    renameSync(temp, linkPath)
    return
  }
  symlinkSync(source, temp)
  renameSync(temp, linkPath)
}

function install(options) {
  const source = resolveSource(options.from)
  const { version, line } = probeVersion(source)
  const paths = layoutPaths(resolvePaths(options))
  const staged = versionBinary(paths, version)
  const existing = readInstallInfo(paths.infoPath)
  const previous =
    existing && existing.version !== version && existsSync(versionBinary(paths, existing.version))
      ? existing.version
      : undefined

  const info = {
    schemaVersion: 1,
    version,
    channel: 'local',
    installedAt: new Date().toISOString(),
    source,
    ...(previous ? { previous } : {}),
  }

  console.log(line)
  console.log(`Target: ${target}`)
  console.log(`Build:  ${displayPath(source)}`)
  if (existing) {
    console.log(`Replacing: Clara ${existing.version} (${existing.source ?? 'unknown source'})`)
  }

  if (options.dryRun) {
    console.log('')
    console.log('Would install:')
    console.log(`  ${displayPath(source)} -> ${displayPath(staged)}`)
    console.log(`  ${displayPath(paths.linkPath)} -> ${displayPath(staged)}`)
    console.log(`  ${displayPath(paths.infoPath)} (generated)`)
    if (previous) console.log(`  keep Clara ${previous} for rollback`)
    return
  }

  mkdirSync(dirname(staged), { recursive: true, mode: 0o700 })
  installFile(source, staged, 0o755)
  activateVersion(staged, paths.linkPath)
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 })
  writeFileAtomic(paths.infoPath, `${JSON.stringify(info, null, 2)}\n`, 0o600)

  console.log('')
  console.log('Installed for the current user:')
  console.log(`  ${displayPath(staged)}`)
  console.log(`  ${displayPath(paths.linkPath)}`)
  console.log(`  ${displayPath(paths.infoPath)}`)

  if (previous) {
    console.log('')
    console.log(`Kept Clara ${previous} for \`clara update --rollback\`.`)
    console.log(
      'If a login service is installed, rerun `clara service install` to point it at this build.'
    )
  }

  if (!(process.env.PATH ?? '').split(windows ? ';' : ':').includes(paths.binDir)) {
    console.log('')
    console.log(`Add ${displayPath(paths.binDir)} to PATH to run \`clara\` from a terminal.`)
  }

  console.log('')
  console.log('Run `clara --version` to confirm, or `clara setup` to start Clara.')
}

function uninstall(options) {
  const paths = layoutPaths(resolvePaths(options))
  const installed = readInstallInfo(paths.infoPath)
  const staged = installed ? versionBinary(paths, installed.version) : undefined
  const binary = existsSync(paths.linkPath)
    ? paths.linkPath
    : staged && existsSync(staged)
      ? staged
      : undefined

  if (!binary) fail('Clara is not installed for the current user. Nothing to remove.')

  const args = ['uninstall', ...(options.purge ? ['--purge'] : []), '--yes']

  if (options.dryRun) {
    console.log(`Would run: ${displayPath(binary)} ${args.join(' ')}`)
    console.log(`  removes ${displayPath(paths.linkPath)} and ${displayPath(paths.versionsDir)}`)
    if (options.purge) {
      console.log(
        `  removes ${displayPath(paths.configDir)}, ${displayPath(paths.dataDir)}, and ${displayPath(paths.cacheDir)}`
      )
    }
    return
  }

  const env = {
    ...process.env,
    CLARA_DATA_DIR: paths.dataDir,
    CLARA_CONFIG_DIR: paths.configDir,
    CLARA_CACHE_DIR: paths.cacheDir,
    ...(options.binDir ? { CLARA_BIN_DIR: paths.binDir } : {}),
  }
  const result = spawnSync(binary, args, { stdio: 'inherit', env })
  if (result.error) fail(`could not run ${displayPath(binary)}: ${result.error.message}`)
  if (result.status !== 0) fail(`\`clara uninstall\` exited ${result.status}.`)

  // A Windows install runs from a copy in the bin directory, which the command
  // cannot delete while it is running. It is unlocked once the child exits.
  if (windows) rmSync(paths.linkPath, { force: true })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  try {
    if (options.uninstall) uninstall(options)
    else install(options)
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause))
  }
}

main()
