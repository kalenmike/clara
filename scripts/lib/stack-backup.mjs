import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { CONTAINERS, SERVICES, VOLUMES } from './stack-control.mjs'

export const BACKUP_IMAGE = 'node:22-bookworm-slim'

/** `clara-backup-YYYYMMDD-HHMMSS.tar.gz` in the current directory. */
export function defaultBackupPath(now = new Date()) {
  const iso = now.toISOString()
  const date = iso.slice(0, 10).replaceAll('-', '')
  const time = iso.slice(11, 19).replaceAll(':', '')
  return resolve(`clara-backup-${date}-${time}.tar.gz`)
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
  return { output: output ?? defaultBackupPath() }
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

export function existingVolumes() {
  return VOLUMES.filter((name) => volumeExists(name))
}

export function runningContainers() {
  return SERVICES.map((name) => CONTAINERS[name]).filter((container) => {
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], {
      encoding: 'utf8',
      timeout: 3_000,
    })
    return !result.error && result.status === 0 && result.stdout.trim() === 'true'
  })
}

export function runBackup({ output, volumes = existingVolumes(), image = BACKUP_IMAGE }) {
  mkdirSync(dirname(output), { recursive: true })
  const fd = openSync(output, 'w', 0o600)
  try {
    const result = spawnSync('docker', backupArgs(volumes, image), {
      stdio: ['ignore', fd, 'inherit'],
    })
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
  }
}

export function runRestore({ archive, image = BACKUP_IMAGE }) {
  const fd = openSync(archive, 'r')
  try {
    const result = spawnSync('docker', restoreArgs(VOLUMES, image), {
      stdio: [fd, 'inherit', 'inherit'],
    })
    if (result.error) throw result.error
    return result.status ?? 1
  } finally {
    closeSync(fd)
  }
}
