import { createRunner } from '@clara/runner'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { orchestrationServiceConfig } from '@clara/adapter-core'
import { readRunnerConfig, runnerConfigPath } from './runner-config.ts'

export interface RunnerCommandOptions {
  once: boolean
  configPath: string
  workspace?: string
  url?: string
  token?: string
  concurrency?: number
  labels: string[]
  id?: string
}

export function parseRunnerOptions(argv: string[]): RunnerCommandOptions {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      once: { type: 'boolean', default: false },
      config: { type: 'string' },
      workspace: { type: 'string', short: 'w' },
      url: { type: 'string' },
      token: { type: 'string' },
      concurrency: { type: 'string', short: 'c' },
      label: { type: 'string', multiple: true, default: [] },
      id: { type: 'string' },
    },
  })
  const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency)
  if (concurrency !== undefined && (!Number.isFinite(concurrency) || concurrency < 1)) {
    throw new Error('--concurrency must be a positive number')
  }
  return {
    once: values.once,
    configPath: values.config ?? runnerConfigPath(),
    ...(values.workspace ? { workspace: values.workspace } : {}),
    ...(values.url ? { url: values.url } : {}),
    ...(values.token ? { token: values.token } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    labels: values.label,
    ...(values.id ? { id: values.id } : {}),
  }
}

export async function runRunner(argv: string[]): Promise<void> {
  const options = parseRunnerOptions(argv)
  const saved = readRunnerConfig(options.configPath)
  const workspace = resolve(
    options.workspace ??
      saved?.workspace ??
      process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ??
      process.cwd()
  )
  const config = orchestrationServiceConfig({
    ...process.env,
    ...(options.url || saved?.url
      ? { CLARA_ORCHESTRATION_URL: options.url ?? saved?.url ?? '' }
      : {}),
  })
  const token = options.token ?? config.token
  if (!token) {
    throw new Error(`no orchestrator token in the environment or at the configured token file`)
  }
  const labels = options.labels.length ? options.labels : (saved?.labels ?? [])
  const concurrency = options.concurrency ?? saved?.concurrency ?? 2
  const runner = createRunner({
    url: config.url,
    token,
    workspace,
    concurrency,
    labels,
    ...(options.id ? { id: options.id } : {}),
    logger: console,
  })

  if (options.once) {
    const claimed = await runner.once()
    console.log(`[clara-runner] ${claimed} step(s) claimed; ${JSON.stringify(runner.status())}`)
    return
  }

  await runner.start()
  const status = runner.status()
  console.log(
    `[clara-runner] ${status.id} watching ${status.workspace} (concurrency ${concurrency})`
  )
  const stop = async (signal: string): Promise<void> => {
    console.log(`[clara-runner] ${signal}; stopping`)
    await runner.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
}
