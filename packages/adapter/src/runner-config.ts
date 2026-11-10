import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { claraConfigDir } from './manifest.ts'

export interface RunnerConfigFile {
  url: string
  workspace: string
  concurrency: number
  labels: string[]
}

export function runnerConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(claraConfigDir(env), 'runner.json')
}

export function readRunnerConfig(path: string): RunnerConfigFile | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<RunnerConfigFile>
    if (
      typeof parsed.url !== 'string' ||
      typeof parsed.workspace !== 'string' ||
      typeof parsed.concurrency !== 'number'
    ) {
      return undefined
    }
    return {
      url: parsed.url,
      workspace: parsed.workspace,
      concurrency: parsed.concurrency,
      labels: Array.isArray(parsed.labels)
        ? parsed.labels.filter((label): label is string => typeof label === 'string')
        : [],
    }
  } catch {
    return undefined
  }
}

export function writeRunnerConfig(path: string, config: RunnerConfigFile): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
