import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from '@clara/orchestration'
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
    expect(result.stdout).toContain('Usage:\n  clara-engine <command> [options]')
    expect(result.stdout).toContain('Commands:')
    expect(result.stdout).toMatch(/^ {2}serve {2,}Run the service in the foreground$/m)
    expect(result.stdout).toMatch(/^ {2}start {2,}Start the service in the background$/m)
    expect(result.stdout).toMatch(/^ {2}stop {2,}Stop the running service$/m)
    expect(result.stdout).toMatch(/^ {2}status {2,}Show which instance is running$/m)
    expect(result.stdout).toMatch(/^ {2}analyze {2,}Analyze run history for failure patterns$/m)
    expect(result.stdout).toMatch(/^ {2}token {2,}Print the orchestration token$/m)
    expect(result.stderr).toBe('')
  })

  it('prints command options for analyze', () => {
    const result = run(['analyze', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      'Usage:\n  clara-engine analyze [--json] [--days <n>] [--db <path>] [--url <url>]'
    )
    expect(result.stdout).toMatch(/^ {2}--json {2,}Print the full report as JSON$/m)
    expect(result.stdout).toMatch(/^ {2}--days <n> {2,}Analysis window in days/m)
  })

  it('prints a JSON report from a database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-cli-diagnostics-'))
    try {
      const path = join(dir, 'engine.db')
      const store = new Store(path)
      const seeded = store.insertRun({
        workspace: '/workspace/clara',
        prompt: 'diagnose',
        target: 'std:diagnostics',
        root_run_id: 0,
        parent_run_id: null,
        parent_step_path: null,
        origin_session_id: null,
        origin_harness: null,
        origin_agent: null,
        origin_kind: 'human',
        pipeline_ref: 'classifier',
        snapshot: '{}',
        hash: 'sha256:test',
        enforcement: 'observed',
        notification: null,
      })
      const at = new Date().toISOString()
      store.updateRun(seeded.id, { state: 'failed', error: 'heartbeat stalled', finished_at: at })
      const latest = store.run(seeded.id)!
      const step = store.ensureStep(latest, {
        path: 'orchestration/route-feature/1-create_spec',
        parent_path: null,
        name: 'create_spec',
        type: 'agent',
        max_attempts: 3,
      })
      store.updateStep(step.id, {
        status: 'failed',
        attempt: 3,
        error: 'heartbeat stalled',
        finished_at: at,
      })
      store.db.close()

      const result = run(['analyze', '--json', '--db', path])
      expect(result.status).toBe(0)
      const report = JSON.parse(result.stdout) as {
        available: boolean
        step_health: Array<{ name: string }>
      }
      expect(report.available).toBe(true)
      expect(report.step_health.some((entry) => entry.name === 'create_spec')).toBe(true)
      expect(result.stderr).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports an unavailable database without failing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-cli-missing-'))
    try {
      const result = run(['analyze', '--json', '--db', join(dir, 'missing.db')])
      expect(result.status).toBe(0)
      const report = JSON.parse(result.stdout) as { available: boolean; reason: string }
      expect(report.available).toBe(false)
      expect(report.reason).toContain('no orchestrator database')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints command options for start', () => {
    const result = run(['start', '--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:\n  clara-engine start [--docker] [--build]')
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
    expect(result.stdout).toContain('Usage:\n  clara-engine stop [--docker]')
    expect(result.stdout).toMatch(/^ {2}--docker {2,}Stop the compose-managed container$/m)
  })

  it('prints per-command help from the help subcommand', () => {
    const result = run(['help', 'serve'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Run the service in the foreground')
    expect(result.stdout).toContain('Usage:\n  clara-engine serve')
  })

  it('prints root help for the help subcommand', () => {
    const result = run(['help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage:\n  clara-engine <command> [options]')
  })
})
