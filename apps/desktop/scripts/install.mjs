#!/usr/bin/env node
// Install an existing Clara desktop build into the current user's XDG
// directories, or remove it again.
//
//   pnpm desktop:install
//   pnpm desktop:install --dry-run
//   pnpm desktop:uninstall [--purge]
//
// This handles Linux only. The Windows and macOS installers already install per
// user, so there is nothing to copy there.
//
// The source is a build that already exists: `dist/desktop` from the Docker
// build, then `apps/desktop/src-tauri/target/release` from a host build. The
// script never builds; run `pnpm desktop:build:docker` or `pnpm desktop:build`
// first. Both the app and its bundled adapter host are installed side by side,
// because the shell looks for the sidecar next to its own executable.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const desktopRoot = join(root, 'apps', 'desktop')
const tauriRoot = join(desktopRoot, 'src-tauri')
const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'))
const appName = config.productName
const appId = config.identifier
const version = config.version

const mainBinary = 'clara-desktop'
const sidecarBinary = 'clara-adapter-host'
const desktopFile = 'clara.desktop'
const scheme = 'clara'

const icons = [
  { source: join(tauriRoot, 'icons', '32x32.png'), size: '32x32' },
  { source: join(tauriRoot, 'icons', '128x128.png'), size: '128x128' },
  { source: join(tauriRoot, 'icons', '128x128@2x.png'), size: '256x256@2' },
]

const help = `Install the built Clara desktop app for the current user.

Usage: pnpm desktop:install [options]
       pnpm desktop:uninstall [--purge]

Options:
  --from <dir>     Build directory to install (default: dist/desktop, then
                   apps/desktop/src-tauri/target/release)
  --prefix <dir>   Install root, holding bin/ and share/ (default: ~/.local)
  --dry-run        Print the plan without writing anything
  --no-verify      Skip the SHA256SUMS check for the build
  --uninstall      Remove the installed app, menu entry, icons, and scheme
  --purge          With --uninstall, also remove pairing and drafts
  -h, --help       Show this help

The build must include ${sidecarBinary}. Rebuild with
\`pnpm desktop:build:docker\` (or \`pnpm desktop:build\` on the host) when it is
missing. Linux only: the Windows and macOS installers already install per user.
`

function fail(message) {
  console.error(`desktop install: ${message}`)
  process.exit(1)
}

function envPath(name) {
  const value = process.env[name]?.trim()
  return value ? resolve(value) : undefined
}

function displayPath(path) {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function parseArgs(argv) {
  const options = {
    from: '',
    prefix: '',
    uninstall: false,
    purge: false,
    dryRun: false,
    verify: true,
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
      case '--prefix':
        options.prefix = value()
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
      case '--no-verify':
        options.verify = false
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

function resolvePrefix(value) {
  if (value) return resolve(value.replace(/^~(?=$|\/)/, homedir()))
  const dataHome = envPath('XDG_DATA_HOME') ?? join(homedir(), '.local', 'share')
  return dirname(dataHome)
}

function installPaths(prefix) {
  const dataDir = join(prefix, 'share')
  return {
    binDir: join(prefix, 'bin'),
    dataDir,
    applicationsDir: join(dataDir, 'applications'),
    iconsDir: join(dataDir, 'icons', 'hicolor'),
    appDataDir: join(dataDir, appId),
    cacheDir: join(envPath('XDG_CACHE_HOME') ?? join(homedir(), '.cache'), appId),
  }
}

function hasBinaries(dir) {
  return existsSync(join(dir, mainBinary)) && existsSync(join(dir, sidecarBinary))
}

function resolveSource(from) {
  if (from) {
    const source = resolve(from.replace(/^~(?=$|\/)/, homedir()))
    if (!existsSync(source)) fail(`--from ${source} does not exist`)
    if (!hasBinaries(source)) {
      fail(
        `${source} is missing ${mainBinary} or ${sidecarBinary}. Point --from at an extracted Linux build.`
      )
    }
    return source
  }

  const candidates = [join(root, 'dist', 'desktop'), join(tauriRoot, 'target', 'release')]
  for (const candidate of candidates) {
    if (hasBinaries(candidate)) return candidate
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, mainBinary))) {
      fail(
        `${displayPath(candidate)} has ${mainBinary} but not ${sidecarBinary}. ` +
          'Rebuild so the bundled adapter host is included: `pnpm desktop:build:docker`, ' +
          'or `pnpm desktop:build` on the host.'
      )
    }
  }

  fail(
    `no desktop build found in ${candidates.map(displayPath).join(' or ')}. ` +
      'Run `pnpm desktop:build:docker`, or `pnpm desktop:build` on the host, then install again.'
  )
}

function verifyChecksums(source, files) {
  const sumsPath = join(source, 'SHA256SUMS')
  if (!existsSync(sumsPath)) return 0

  const sums = new Map()
  for (const line of readFileSync(sumsPath, 'utf8').split('\n')) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (!match) continue
    sums.set(match[2].replace(/^\.\//, ''), match[1].toLowerCase())
  }

  const missing = files.filter((file) => !sums.has(file))
  if (missing.length > 0) {
    fail(`SHA256SUMS in ${source} does not cover ${missing.join(', ')}. Rebuild before installing.`)
  }

  for (const file of files) {
    const actual = createHash('sha256')
      .update(readFileSync(join(source, file)))
      .digest('hex')
    if (actual !== sums.get(file)) {
      fail(`${file} does not match SHA256SUMS. Rebuild before installing.`)
    }
  }

  return files.length
}

function installFile(source, target, mode) {
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  copyFileSync(source, temp)
  chmodSync(temp, mode)
  renameSync(temp, target)
}

function writeFileAtomic(target, content, mode) {
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, content, { mode })
  renameSync(temp, target)
}

function desktopEntry(binPath) {
  const exec = binPath.includes(' ') ? `"${binPath}"` : binPath
  return [
    '[Desktop Entry]',
    'Categories=Development;',
    `Comment=${appName} desktop client`,
    `Exec=${exec}`,
    `StartupWMClass=${mainBinary}`,
    'Icon=clara-desktop',
    `Name=${appName}`,
    'Terminal=false',
    'Type=Application',
    `MimeType=x-scheme-handler/${scheme}`,
    '',
  ].join('\n')
}

function refreshIntegration(paths) {
  const skipped = []
  const refresh = (command, args, env) => {
    const result = spawnSync(command, args, {
      stdio: 'ignore',
      env: { ...process.env, ...env },
    })
    if (result.error || result.status !== 0) skipped.push(command)
  }

  refresh('update-desktop-database', [paths.applicationsDir])
  refresh('gtk-update-icon-cache', ['-f', '-t', paths.iconsDir])
  refresh('xdg-mime', ['default', desktopFile, `x-scheme-handler/${scheme}`], {
    XDG_DATA_HOME: paths.dataDir,
  })

  return skipped
}

function install(options) {
  const prefix = resolvePrefix(options.prefix)
  const paths = installPaths(prefix)
  const source = resolveSource(options.from)
  const files = [mainBinary, sidecarBinary]

  const verified = options.verify ? verifyChecksums(source, files) : 0

  const binPath = join(paths.binDir, mainBinary)
  const targets = [
    { source: join(source, mainBinary), target: binPath, mode: 0o755 },
    { source: join(source, sidecarBinary), target: join(paths.binDir, sidecarBinary), mode: 0o755 },
    ...icons.map((icon) => ({
      source: icon.source,
      target: join(paths.iconsDir, icon.size, 'apps', 'clara-desktop.png'),
      mode: 0o644,
    })),
    {
      content: desktopEntry(binPath),
      target: join(paths.applicationsDir, desktopFile),
      mode: 0o644,
    },
  ]

  console.log(`${appName} ${version}`)
  console.log(`Source: ${displayPath(source)}`)
  if (verified > 0) console.log(`Checksums: ${verified} files verified`)

  if (options.dryRun) {
    console.log('Would install:')
    for (const target of targets) {
      const from = target.content ? '(generated)' : displayPath(target.source)
      console.log(`  ${from} -> ${displayPath(target.target)}`)
    }
    return
  }

  for (const target of targets) {
    if (target.content !== undefined) {
      writeFileAtomic(target.target, target.content, target.mode)
    } else {
      installFile(target.source, target.target, target.mode)
    }
  }

  const skipped = refreshIntegration(paths)

  console.log('Installed for the current user:')
  for (const target of targets) console.log(`  ${displayPath(target.target)}`)

  if (skipped.length > 0) {
    console.log('')
    console.log(`Skipped ${skipped.join(', ')}; not installed on this machine.`)
  }

  const onPath = (process.env.PATH ?? '').split(':').includes(paths.binDir)
  if (!onPath) {
    console.log('')
    console.log(`Add ${displayPath(paths.binDir)} to PATH to run ${mainBinary} from a terminal.`)
  }

  console.log('')
  console.log(`Launch ${appName} from the application menu, or run \`${mainBinary}\`.`)
}

function uninstall(options) {
  const prefix = resolvePrefix(options.prefix)
  const paths = installPaths(prefix)

  const targets = [
    join(paths.binDir, mainBinary),
    join(paths.binDir, sidecarBinary),
    join(paths.applicationsDir, desktopFile),
    ...icons.map((icon) => join(paths.iconsDir, icon.size, 'apps', 'clara-desktop.png')),
  ]

  console.log(`${appName} ${version}`)

  if (options.dryRun) {
    console.log('Would remove:')
    for (const target of targets) console.log(`  ${displayPath(target)}`)
    if (options.purge) {
      console.log(`  ${displayPath(paths.appDataDir)}`)
      console.log(`  ${displayPath(paths.cacheDir)}`)
    }
    return
  }

  const removed = targets.filter((target) => existsSync(target))
  for (const target of removed) rmSync(target, { force: true })

  if (removed.length > 0) {
    const skipped = refreshIntegration(paths)
    if (skipped.includes('gtk-update-icon-cache')) {
      console.log('')
      console.log('Skipped gtk-update-icon-cache; not installed on this machine.')
    }
    console.log('Removed:')
    for (const target of removed) console.log(`  ${displayPath(target)}`)
  } else {
    console.log('Nothing was installed for the current user.')
  }

  if (options.purge) {
    for (const target of [paths.appDataDir, paths.cacheDir]) {
      if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    }
    console.log('')
    console.log('Removed pairing, drafts, and cached app data.')
    return
  }

  if (existsSync(paths.appDataDir) || existsSync(paths.cacheDir)) {
    console.log('')
    console.log(`Pairing and drafts stay in ${displayPath(paths.appDataDir)}.`)
    console.log('Run with --purge to remove them too.')
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (process.platform !== 'linux') {
    fail(
      'this script handles Linux only. Open the .dmg or .exe from the build output; ' +
        'the macOS and Windows installers already install for the current user.'
    )
  }
  if (options.uninstall) uninstall(options)
  else install(options)
}

main()
