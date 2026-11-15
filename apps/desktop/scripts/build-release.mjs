#!/usr/bin/env node
// Build the Clara desktop installers for the host platform the way a release
// does, and collect them in dist/desktop-release.
//
//   node apps/desktop/scripts/build-release.mjs
//   node apps/desktop/scripts/build-release.mjs --version 0.2.0
//   node apps/desktop/scripts/build-release.mjs --bundles dmg
//
// The script builds the adapter-host sidecar, stamps the release version into
// the Tauri config and the web bundle, runs `tauri build`, verifies the sidecar
// is packaged, and writes SHA256SUMS next to the installers. It only builds on
// the host: macOS and Windows installers need their own machines. CI runs the
// same script on one runner per platform through
// `.github/workflows/desktop-releases.yml`.
//
// Installers are unsigned. This script does not sign, notarize, or publish.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromDesktop = createRequire(import.meta.url)
const tauriCli = requireFromDesktop.resolve('@tauri-apps/cli/tauri.js')

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const desktopRoot = join(root, 'apps', 'desktop')
const tauriRoot = join(desktopRoot, 'src-tauri')
const distRoot = join(root, 'dist')
const defaultOutput = join(distRoot, 'desktop-release')

const defaultBundles = {
  darwin: 'app,dmg',
  win32: 'msi,nsis',
  linux: 'deb,rpm,appimage',
}

const supportedBundles = {
  darwin: new Set(['app', 'dmg']),
  win32: new Set(['msi', 'nsis']),
  linux: new Set(['deb', 'rpm', 'appimage']),
}

// A bundle either ships a file or only prepares one for another bundle. `app`
// produces the macOS app directory that the DMG wraps, so it has no artifact of
// its own.
const distributables = {
  dmg: { extension: '.dmg', label: 'DMG disk image' },
  msi: { extension: '.msi', label: 'MSI installer' },
  nsis: { extension: '.exe', label: 'NSIS installer', match: /setup\.exe$/i },
  deb: { extension: '.deb', label: 'Debian package' },
  rpm: { extension: '.rpm', label: 'RPM package' },
  appimage: { extension: '.AppImage', label: 'AppImage' },
}

const help = `Build the Clara desktop installers for this platform.

Usage: node apps/desktop/scripts/build-release.mjs [options]

Options:
  --version <version>   Release version stamped into the app and installers
                        (default: CLARA_VERSION, then <package version>-dev+<sha>)
  --bundles <list>      Comma-separated bundle list
                        (default: ${Object.entries(defaultBundles)
                          .map(([platform, bundles]) => `${platform} ${bundles}`)
                          .join(', ')})
  --target <triple>     Rust target triple for a native build
                        (default: this host's triple)
  --commit <sha>        Commit stamp for the web build (default: git HEAD)
  --output <dir>        Collection directory under dist/
                        (default: dist/desktop-release)
  --no-verify           Skip the packaged adapter-host checks
  -h, --help            Show this help

The build runs the desktop web bundle, the adapter-host sidecar, and Tauri on
this machine. It cannot cross-compile: use a macOS runner for the macOS
installers and a Windows runner for the Windows installers.

Installers are unsigned, so the operating system may warn on the first launch.
`

function fail(message) {
  console.error(`desktop release: ${message}`)
  process.exit(1)
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) fail(`${command} could not run: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function parseArgs(argv) {
  const options = {
    version: process.env.CLARA_VERSION?.trim() || '',
    bundles: process.env.TAURI_BUNDLES?.trim() || '',
    target: '',
    commit: process.env.CLARA_COMMIT?.trim() || '',
    output: defaultOutput,
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
      case '--version':
        options.version = value()
        break
      case '--bundles':
        options.bundles = value()
        break
      case '--target':
        options.target = value()
        break
      case '--commit':
        options.commit = value()
        break
      case '--output':
        options.output = resolve(root, value())
        break
      case '--no-verify':
        options.verify = false
        break
      case '-h':
      case '--help':
        console.log(help)
        process.exit(0)
        break
      default:
        fail(`unknown option ${arg}. Try --help.`)
    }
  }

  return options
}

function hostTarget() {
  const configured =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.CARGO_BUILD_TARGET?.trim()
  if (configured) return configured

  const rustc = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  const host = rustc.status === 0 ? /^host:\s*(\S+)$/m.exec(rustc.stdout)?.[1] : undefined
  if (host) return host

  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (process.platform === 'darwin') return `${arch}-apple-darwin`
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`
  return `${arch}-unknown-linux-gnu`
}

function packageVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function resolveVersion(configured) {
  if (configured) return configured.replace(/^v/, '')
  const commit = capture('git', ['rev-parse', '--short=7', 'HEAD']) || 'local'
  return `${packageVersion()}-dev+${commit}`
}

function resolveCommit(configured) {
  const commit = configured || capture('git', ['rev-parse', '--short=8', 'HEAD'])
  if (!commit) return ''
  return /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 8) : commit
}

function resolveBundles(configured) {
  const platformDefaults = defaultBundles[process.platform]
  if (!platformDefaults) {
    fail(`unsupported platform ${process.platform}: build on Linux, macOS, or Windows`)
  }

  const requested = (configured || platformDefaults)
    .split(',')
    .map((bundle) => bundle.trim().toLowerCase())
    .filter(Boolean)
  if (requested.length === 0) fail('--bundles needs at least one bundle')

  const allowed = supportedBundles[process.platform]
  for (const bundle of requested) {
    if (!allowed.has(bundle)) {
      fail(
        `${bundle} is not a ${process.platform} bundle. ` +
          `${process.platform} supports ${[...allowed].join(', ')}.`
      )
    }
  }

  const unique = [...new Set(requested)]
  if (!unique.some((bundle) => bundle in distributables)) {
    fail(
      `${unique.join(',')} produces no installer file. ` +
        `Add one of ${Object.keys(distributables).join(', ')}.`
    )
  }
  return unique
}

function normalizeVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`invalid version ${version}. Use a semver such as 0.2.0 or 0.2.0-rc.1.`)
  }
  return version
}

function walkFiles(directory) {
  if (!existsSync(directory)) return []
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function findByExtension(directory, extension) {
  return walkFiles(directory).filter((path) => basename(path).endsWith(extension))
}

function findInstaller(bundleDir, bundle) {
  const spec = distributables[bundle]
  const files = findByExtension(bundleDir, spec.extension)
  return files.filter((path) => (spec.match ? spec.match.test(basename(path)) : true))
}

function verifySidecar({ bundleDir, targetDir, target, bundles, enabled }) {
  if (!enabled) return

  const executable = process.platform === 'win32' ? '.exe' : ''
  const sidecar = `clara-adapter-host${executable}`
  const source = join(tauriRoot, 'binaries', `clara-adapter-host-${target}${executable}`)
  if (!existsSync(source)) fail(`the adapter host was not built at ${source}`)

  const macBundle = existsSync(join(bundleDir, 'macos'))
    ? readdirSync(join(bundleDir, 'macos'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
        .map((entry) => join(bundleDir, 'macos', entry.name))
    : []
  if (process.platform === 'darwin' && macBundle.length > 0) {
    const packaged = join(macBundle[0], 'Contents', 'MacOS', sidecar)
    if (!existsSync(packaged)) fail(`the adapter host is missing from ${basename(macBundle[0])}`)
    return
  }

  if (process.platform === 'linux' && bundles.includes('deb')) {
    for (const deb of findInstaller(bundleDir, 'deb')) {
      const listing = spawnSync('dpkg-deb', ['-c', deb], { encoding: 'utf8' })
      if (listing.error?.code === 'ENOENT') {
        console.warn('desktop release: dpkg-deb is unavailable; skipped the package check')
        continue
      }
      if (listing.status !== 0) fail(`could not inspect ${basename(deb)}: ${listing.stderr.trim()}`)
      if (!listing.stdout.includes(sidecar))
        fail(`the adapter host is missing from ${basename(deb)}`)
    }
    return
  }

  if (process.platform === 'win32') {
    const packaged = join(targetDir, sidecar)
    if (!existsSync(packaged)) {
      console.warn(`desktop release: could not confirm ${sidecar} in the Windows bundle`)
    }
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const version = normalizeVersion(resolveVersion(options.version))
  const commit = resolveCommit(options.commit)
  const target = options.target || hostTarget()
  const bundles = resolveBundles(options.bundles)
  const dirty = process.env.CLARA_DIRTY ?? (capture('git', ['status', '--porcelain']) ? '1' : '0')

  const distPrefix = `${distRoot}${sep}`
  if (!options.output.startsWith(distPrefix) || options.output === distPrefix) {
    fail('--output must be a directory under dist/')
  }

  const config = JSON.stringify({ version })

  const env = {
    ...process.env,
    CLARA_VERSION: version,
    CLARA_COMMIT: commit,
    CLARA_DIRTY: dirty,
  }
  if (process.platform === 'linux') {
    // linuxdeploy's strip step cannot read newer ELF relocation sections, and
    // AppImage tooling needs FUSE; extract-and-run avoids requiring /dev/fuse.
    env.NO_STRIP = 'true'
    env.APPIMAGE_EXTRACT_AND_RUN = '1'
  }

  rmSync(options.output, { recursive: true, force: true })
  mkdirSync(options.output, { recursive: true })

  console.log(`Version: ${version}`)
  console.log(`Target:  ${target}`)
  console.log(`Bundles: ${bundles.join(', ')}`)
  console.log('')

  run(process.execPath, [join(desktopRoot, 'host', 'scripts', 'build.mjs'), '--target', target], {
    env,
  })
  run(
    process.execPath,
    [tauriCli, 'build', '--target', target, '--bundles', bundles.join(','), '--config', config],
    { env, cwd: desktopRoot }
  )

  const targetDir = join(tauriRoot, 'target', target, 'release')
  const bundleDir = join(targetDir, 'bundle')

  verifySidecar({
    bundleDir,
    targetDir,
    target,
    bundles,
    enabled: options.verify,
  })

  const copied = []
  for (const bundle of bundles) {
    if (!(bundle in distributables)) continue
    const installers = findInstaller(bundleDir, bundle)
    if (installers.length === 0) {
      fail(`Tauri did not produce a ${distributables[bundle].label} in ${bundleDir}`)
    }
    for (const installer of installers) {
      const destination = join(options.output, basename(installer))
      if (existsSync(destination)) fail(`two installers share the name ${basename(installer)}`)
      copyFileSync(installer, destination)
      copied.push(destination)
    }
  }

  copied.sort()
  const sums = copied.map((path) => `${sha256(path)}  ${basename(path)}`).join('\n')
  writeFileSync(join(options.output, 'SHA256SUMS'), `${sums}\n`)

  console.log('')
  console.log(`Desktop artifacts: ${options.output}`)
  for (const path of copied) {
    console.log(`  ${basename(path).padEnd(40)} ${formatBytes(statSync(path).size)}`)
  }
  console.log('  SHA256SUMS')
  console.log('')
  console.log('Installers are unsigned. Publish them with the desktop-releases workflow.')
}

main()
