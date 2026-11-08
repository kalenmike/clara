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
  it('prints help when no subcommand is given', () => {
    const result = run([])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: clara-orchestrator')
    expect(result.stderr).toBe('')
  })

  it('prints help for the help subcommand', () => {
    const result = run(['help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: clara-orchestrator')
  })
})
