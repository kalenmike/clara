import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))

function run(args: string[]) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', entry, ...args],
    {
      encoding: 'utf8',
    }
  )
}

describe('orchestrator CLI', () => {
  it('prints structured help when no subcommand is given', () => {
    const result = run([])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:\n  clara-orchestrator <command> [options]')
    expect(result.stdout).toContain('Commands:')
    expect(result.stdout).toMatch(/^ {2}serve {2,}Run the service in the foreground$/m)
    expect(result.stdout).toMatch(/^ {2}start {2,}Start the service in the background$/m)
    expect(result.stdout).toMatch(/^ {2}stop {2,}Stop the running service$/m)
    expect(result.stdout).toMatch(/^ {2}status {2,}Show which instance is running$/m)
    expect(result.stdout).toMatch(/^ {2}token {2,}Print the orchestration token$/m)
    expect(result.stderr).toBe('')
  })

  it('prints command options for start', () => {
    const result = run(['start', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:\n  clara-orchestrator start [--docker] [--build]')
    expect(result.stdout).toMatch(
      /^ {2}--docker {2,}Start the compose-managed container instead of a local process$/m
    )
    expect(result.stdout).toMatch(
      /^ {2}--build {2,}Rebuild the image before starting \(requires --docker\)$/m
    )
  })

  it('prints command options for stop', () => {
    const result = run(['stop', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:\n  clara-orchestrator stop [--docker]')
    expect(result.stdout).toMatch(/^ {2}--docker {2,}Stop the compose-managed container$/m)
  })

  it('prints per-command help from the help subcommand', () => {
    const result = run(['help', 'serve'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Run the service in the foreground')
    expect(result.stdout).toContain('Usage:\n  clara-orchestrator serve')
  })

  it('prints root help for the help subcommand', () => {
    const result = run(['help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:\n  clara-orchestrator <command> [options]')
  })
})
