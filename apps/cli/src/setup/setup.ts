import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaraPaths } from '../paths.ts'
import type { Ports } from '../ports.ts'
import { selfCommand } from '../self.ts'
import { defaultServices, startStack } from '../service/lifecycle.ts'
import { detectService, installPlan, applyPlan } from '../service-manager/index.ts'
import type { ServiceKind } from '../service-manager/index.ts'

export type SetupOptions = {
  paths: ClaraPaths
  ports: Ports
  username?: string
  password?: string
  installService: boolean
  start: boolean
}

export type SetupStep = {
  name: string
  status: 'done' | 'skipped' | 'failed'
  detail?: string
}

export type SetupResult = {
  code: number
  steps: SetupStep[]
  service: ServiceKind
}

/**
 * First-run setup. Every step is idempotent: running it again repairs missing
 * directories, reuses the owner account, and adopts a running stack.
 */
export async function runSetup(options: SetupOptions): Promise<SetupResult> {
  const steps: SetupStep[] = []
  const service = detectService()
  const fail = (name: string, detail: string): SetupResult => {
    steps.push({ name, status: 'failed', detail })
    return { code: 1, steps, service }
  }

  for (const directory of [
    options.paths.configDir,
    options.paths.dataDir,
    options.paths.cacheDir,
    options.paths.logDir,
    join(options.paths.configDir, 'engine'),
    join(options.paths.dataDir, 'engine', 'packages'),
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  steps.push({ name: 'created the Clara directories', status: 'done' })

  if (options.start) {
    const code = await startStack({
      paths: options.paths,
      ports: options.ports,
      services: defaultServices(),
      foreground: false,
    })
    if (code !== 0) return fail('started the Clara stack', 'see `clara logs --no-follow`')
    steps.push({ name: 'started the Clara stack', status: 'done' })
  } else {
    steps.push({ name: 'started the Clara stack', status: 'skipped', detail: '--no-start' })
  }

  // The hub creates the owner over its loopback panel API, so the stack has to
  // be running first. A hub with no owner only serves the setup screen.
  const username = options.username
  const password = options.password
  if (username && password && options.start) {
    const result = await createOwner(username, password)
    if (result.code !== 0)
      return fail('created the hub owner account', result.error ?? 'hub setup failed')
    steps.push({ name: 'created the hub owner account', status: 'done', detail: username })
  } else if (username && password) {
    steps.push({
      name: 'created the hub owner account',
      status: 'skipped',
      detail: 'start Clara, then run `clara setup` again',
    })
  } else {
    steps.push({
      name: 'created the hub owner account',
      status: 'skipped',
      detail: 'create it in the panel',
    })
  }

  if (options.installService) {
    if (service === 'none') {
      steps.push({
        name: 'installed the login service',
        status: 'skipped',
        detail: 'no supported service manager; run `clara start`',
      })
    } else {
      const binary = process.execPath
      const plan = installPlan(service, {
        homeDir: process.env.HOME ?? options.paths.configDir,
        configDir: options.paths.configDir,
        dataDir: options.paths.dataDir,
        cacheDir: options.paths.cacheDir,
        logDir: options.paths.logDir,
        execPath: binary,
      })
      const result = applyPlan(plan)
      if (result.errors.length > 0) {
        return fail('installed the login service', result.errors.join('; '))
      }
      steps.push({ name: 'installed the login service', status: 'done', detail: service })
    }
  } else {
    steps.push({ name: 'installed the login service', status: 'skipped', detail: '--no-service' })
  }

  return { code: 0, steps, service }
}

function createOwner(
  username: string,
  password: string
): Promise<{ code: number; error?: string }> {
  return new Promise((resolve) => {
    const invocation = selfCommand(['__hub', 'setup', '--username', username, '--password-stdin'])
    const child = spawn(invocation.command, invocation.args, {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let error = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      error += chunk.toString('utf8')
    })
    child.once('error', (cause) => resolve({ code: 1, error: cause.message }))
    child.once('exit', (code) => {
      if (code === 0) resolve({ code: 0 })
      else resolve({ code: code ?? 1, error: error.trim() || `hub setup exited ${code ?? 1}` })
    })
    child.stdin?.end(`${password}\n`)
  })
}
