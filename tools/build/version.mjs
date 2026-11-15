import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Version identity shared by the build scripts and the Lab entry.
 *
 * A release build passes its version explicitly. A checkout build identifies
 * the commit it came from, e.g. `0.1.0-dev+abc1234`, so two local builds never
 * look like the same artifact.
 */
export function devVersion(packageVersion, commit) {
  return `${packageVersion}-dev+${commit || 'local'}`
}

export function buildVersion({ env = process.env, packageVersion, commit }) {
  const configured = env.CLARA_VERSION?.trim()
  return configured || devVersion(packageVersion, commit)
}

/** Identify the repository that contains `cwd`, for a process started directly. */
export function checkoutVersion(cwd = process.cwd()) {
  const top = gitValue(cwd, ['rev-parse', '--show-toplevel']) || cwd
  return devVersion(
    readPackageVersion(top),
    gitValue(top, ['rev-parse', '--short=7', 'HEAD']) || undefined
  )
}

function readPackageVersion(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function gitValue(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : ''
}
