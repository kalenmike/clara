import { spawnSync } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { CONTAINERS, SERVICES, VOLUMES } from './stack-control.mjs'

export const BACKUP_IMAGE = 'node:22-bookworm-slim'
export const BACKUP_MANIFEST = 'clara-backup.json'

export const BACKUP_TARGETS = {
  default: VOLUMES,
  hub: ['clara-server-config', 'clara-server-data'],
  orchestrator: ['clara-orchestrator-data'],
}

export function targetVolumes(target) {
  const volumes = BACKUP_TARGETS[target]
  if (!volumes) throw new Error(`unknown backup target: ${target}`)
  return volumes
}

export function targetContainers(target) {
  if (target === 'default') return SERVICES.map((name) => CONTAINERS[name])
  if (target === 'hub') return [CONTAINERS.server]
  if (target === 'orchestrator') return [CONTAINERS.orchestrator]
  return []
}

/** `clara-backup-YYYYMMDD-HHMMSS.tar.gz` in the current directory. */
export function defaultBackupPath(target = 'default', now = new Date()) {
  const iso = now.toISOString()
  const date = iso.slice(0, 10).replaceAll('-', '')
  const time = iso.slice(11, 19).replaceAll(':', '')
  const prefix = target === 'default' ? 'clara' : `clara-${target}`
  return resolve(`${prefix}-backup-${date}-${time}.tar.gz`)
}

export function parseBackupArgs(args) {
  let output
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--output' || arg === '-o') {
      const value = args[++index]
      if (!value) throw new Error(`${arg} requires a path`)
      output = resolve(value)
      continue
    }
    throw new Error(`unknown option: ${arg}`)
  }
  return { output }
}

export function parseRestoreArgs(args) {
  let archive
  let force = false
  for (const arg of args) {
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`)
    if (archive) throw new Error(`unexpected argument: ${arg}`)
    archive = resolve(arg)
  }
  if (!archive) throw new Error('restore requires an archive path')
  return { archive, force }
}

export function backupArgs(volumes = VOLUMES, image = BACKUP_IMAGE) {
  return [
    'run',
    '--rm',
    ...volumes.flatMap((name) => ['-v', `${name}:/state/${name}:ro`]),
    image,
    'tar',
    'czf',
    '-',
    '-C',
    '/state',
    '.',
  ]
}

export function restoreArgs(volumes = VOLUMES, image = BACKUP_IMAGE) {
  return [
    'run',
    '--rm',
    '-i',
    ...volumes.flatMap((name) => ['-v', `${name}:/state/${name}`]),
    image,
    'sh',
    '-c',
    'find /state -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf - -C /state',
  ]
}

function volumeExists(name) {
  const result = spawnSync('docker', ['volume', 'inspect', name], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

export function existingVolumes(volumes = VOLUMES) {
  return volumes.filter((name) => volumeExists(name))
}

export function runningContainers(target = 'default') {
  return targetContainers(target).filter((container) => {
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], {
      encoding: 'utf8',
      timeout: 3_000,
    })
    return !result.error && result.status === 0 && result.stdout.trim() === 'true'
  })
}

export function runBackup({
  output,
  target = 'default',
  volumes = targetVolumes(target),
  image = BACKUP_IMAGE,
}) {
  mkdirSync(dirname(output), { recursive: true })
  const manifestDir = mkdtempSync(join(tmpdir(), 'clara-backup-'))
  const manifestPath = join(manifestDir, BACKUP_MANIFEST)
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        target,
        volumes,
        createdAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
  const fd = openSync(output, 'w', 0o600)
  try {
    const args = [
      'run',
      '--rm',
      ...volumes.flatMap((name) => ['-v', `${name}:/state/${name}:ro`]),
      '-v',
      `${manifestDir}:/manifest:ro`,
      image,
      'tar',
      'czf',
      '-',
      '-C',
      '/state',
      '.',
      '-C',
      '/manifest',
      BACKUP_MANIFEST,
    ]
    const result = spawnSync('docker', args, { stdio: ['ignore', fd, 'inherit'] })
    if (result.error) {
      unlinkSync(output)
      throw result.error
    }
    if (result.status !== 0) {
      unlinkSync(output)
      return result.status ?? 1
    }
    return 0
  } finally {
    closeSync(fd)
    rmSync(manifestDir, { recursive: true, force: true })
  }
}

export function runRestore({ archive, volumes = VOLUMES, image = BACKUP_IMAGE }) {
  const fd = openSync(archive, 'r')
  try {
    const result = spawnSync('docker', restoreArgs(volumes, image), {
      stdio: [fd, 'inherit', 'inherit'],
    })
    if (result.error) throw result.error
    return result.status ?? 1
  } finally {
    closeSync(fd)
  }
}

export function readBackupManifest({ archive, image = BACKUP_IMAGE }) {
  const result = spawnSync(
    'docker',
    ['run', '--rm', '-i', image, 'tar', 'xzOf', '-', BACKUP_MANIFEST],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      input: readFileSync(archive),
      encoding: 'utf8',
    }
  )
  if (result.error || result.status !== 0 || !result.stdout.trim()) return undefined
  try {
    const parsed = JSON.parse(result.stdout)
    if (parsed?.version !== 1) return undefined
    if (!Array.isArray(parsed.volumes)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export function archiveVolumes({ archive, image = BACKUP_IMAGE }) {
  const result = spawnSync('docker', ['run', '--rm', '-i', image, 'tar', 'tzf', '-'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    input: readFileSync(archive),
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) return []
  const names = new Set()
  for (const line of String(result.stdout).split('\n')) {
    const match = /^\.?\/?([^/]+)\//.exec(line.trim())
    if (match && VOLUMES.includes(match[1])) names.add(match[1])
  }
  return VOLUMES.filter((name) => names.has(name))
}
