#!/usr/bin/env node
// Build the Linux desktop bundles in Docker and extract them to dist/desktop.
//
//   pnpm desktop:build:docker
//   pnpm desktop:build:docker --bundles deb --platform linux/amd64
//
// A Linux container can only build Linux bundles. macOS and Windows
// installers must be built on those hosts.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const distRoot = join(root, 'dist')
const defaultOutput = join(distRoot, 'desktop')
const defaultBundles = 'deb,rpm,appimage'
const validBundles = new Set(['deb', 'rpm', 'appimage'])

const help = `Build the Clara desktop bundles for Linux in Docker.

Usage: pnpm desktop:build:docker [options]

Options:
  --bundles <list>      Comma-separated Linux bundles (default: ${defaultBundles})
  --platform <platform> Docker platform, for example linux/amd64 (default: host)
  --output <dir>        Extraction directory under dist/ (default: dist/desktop)
  --base <image>        Builder base image (default: node:22-bookworm)
  --no-cache            Ignore the Docker layer cache for this build
  -h, --help            Show this help

The container is Debian 12 with Rust, Node 22, and the Tauri Linux
prerequisites. Cargo, Tauri tool downloads, and the Rust target directory are
kept in Docker cache mounts, so later builds are incremental.
`

function fail(message) {
  console.error(`desktop build: ${message}`)
  process.exit(1)
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
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

function parseArgs(argv) {
  const options = {
    bundles: process.env.TAURI_BUNDLES?.trim() || defaultBundles,
    platform: '',
    output: defaultOutput,
    base: '',
    noCache: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[(index += 1)]
      if (next === undefined || next.startsWith('--')) fail(`${arg} needs a value`)
      return next
    }

    switch (arg) {
      case '--bundles':
        options.bundles = value()
        break
      case '--platform':
        options.platform = value()
        break
      case '--output':
        options.output = resolve(root, value())
        break
      case '--base':
        options.base = value()
        break
      case '--no-cache':
        options.noCache = true
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

  const bundles = options.bundles.split(',').map((bundle) => bundle.trim())
  if (bundles.length === 0 || bundles.some((bundle) => !validBundles.has(bundle))) {
    fail(`--bundles must be a comma-separated list of ${[...validBundles].join(', ')}`)
  }
  options.bundles = bundles.join(',')

  const distPrefix = `${distRoot}${sep}`
  if (!options.output.startsWith(distPrefix) || options.output === distPrefix) {
    fail('--output must be a directory under dist/')
  }

  return options
}

function requireDocker() {
  const version = spawnSync('docker', ['version'], { encoding: 'utf8' })
  if (version.error?.code === 'ENOENT') {
    fail('Docker is not installed. Install Docker and retry.')
  }
  if (version.status !== 0) {
    const detail = version.stderr.trim().split('\n').at(-1)
    fail(`Docker is not available${detail ? `: ${detail}` : '.'}`)
  }

  const buildx = spawnSync('docker', ['buildx', 'version'], { encoding: 'utf8' })
  if (buildx.status !== 0) {
    fail('Docker Buildx is required for cache mounts and artifact extraction.')
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  requireDocker()

  const commit =
    process.env.CLARA_COMMIT?.trim() || capture('git', ['rev-parse', '--short=8', 'HEAD'])
  const dirty =
    process.env.CLARA_DIRTY ?? (capture('git', ['status', '--porcelain']).length > 0 ? '1' : '0')

  rmSync(options.output, { recursive: true, force: true })
  mkdirSync(options.output, { recursive: true })

  const args = [
    'buildx',
    'build',
    '--file',
    'infra/docker/desktop.Dockerfile',
    '--target',
    'artifacts',
    '--output',
    `type=local,dest=${options.output}`,
    '--build-arg',
    `TAURI_BUNDLES=${options.bundles}`,
    '--build-arg',
    `CLARA_COMMIT=${commit}`,
    '--build-arg',
    `CLARA_DIRTY=${dirty}`,
  ]
  if (options.base) args.push('--build-arg', `BASE_IMAGE=${options.base}`)
  if (options.platform) args.push('--platform', options.platform)
  if (options.noCache) args.push('--no-cache')
  args.push(root)

  const build = spawnSync('docker', args, { cwd: root, stdio: 'inherit' })
  if (build.error) fail(`Docker could not run: ${build.error.message}`)
  if (build.status !== 0) process.exit(build.status ?? 1)

  const files = readdirSync(options.output).sort()
  if (!files.some((file) => /\.(deb|rpm|AppImage)$/.test(file))) {
    fail(`Docker finished but ${options.output} has no installers. Check the build log above.`)
  }

  console.log('')
  console.log(`Desktop artifacts: ${options.output}`)
  for (const file of files) {
    const path = join(options.output, file)
    if (!existsSync(path)) continue
    console.log(`  ${file.padEnd(40)} ${formatBytes(statSync(path).size)}`)
  }
  console.log('')
  console.log('A Linux container builds Linux bundles only.')
  console.log('macOS and Windows installers must be built on their own hosts.')
  if (files.includes('Cargo.lock')) {
    console.log('Cargo.lock is next to the artifacts; commit it if dependencies changed.')
  }
}

main()
