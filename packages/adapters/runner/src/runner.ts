import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { createRunner } from './loop.ts'
import { engineToken, engineURL, readRunnerConfig, runnerConfigPath } from './config.ts'

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
      process.env.CLARA_ENGINE_WORKSPACE?.trim() ??
      process.env.CLARA_ORCHESTRATION_WORKSPACE?.trim() ??
      process.cwd()
  )
  const url = options.url ?? saved?.url ?? engineURL()
  const token = options.token ?? engineToken()
  if (!token) {
    throw new Error('no engine token in the environment or at the configured token file')
  }
  const labels = options.labels.length ? options.labels : (saved?.labels ?? [])
  const concurrency = options.concurrency ?? saved?.concurrency ?? 2
  // Without an explicit or saved URL the endpoint comes from engine.json, so
  // re-resolve it per request: a restarting adapter daemon republishes the
  // gateway with a new port and token, and the runner must follow.
  const dynamicEndpoint = !options.url && !saved?.url
  const runner = createRunner({
    url,
    token,
    ...(dynamicEndpoint
      ? {
          resolve: () => ({
            url: engineURL(),
            token: options.token ?? engineToken(),
          }),
        }
      : {}),
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
