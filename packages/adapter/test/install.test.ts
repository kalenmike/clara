import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseOptions } from '../src/args.ts'
import { install } from '../src/install.ts'

function withConfigHome(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-install-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    run(dir)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('plans an OpenCode install without writing when --dry-run is set', () => {
  withConfigHome(() => {
    const result = install(parseOptions(['install', '--opencode', '--no-service', '--dry-run']))
    assert.equal(result.manifest.harnesses.opencode?.pluginPath.endsWith('clara-policy'), true)
    assert.equal(result.manifest.runner?.workspace, process.cwd())
    assert.ok(result.actions.some((action) => action.includes('link plugin')))
  })
})

test('writes the OpenCode config and shared runner manifest', () => {
  withConfigHome((dir) => {
    install(parseOptions(['install', '--opencode', '--no-service']))
    const policy = JSON.parse(readFileSync(join(dir, 'opencode', 'clara-policy.json'), 'utf8')) as {
      runner?: { enabled?: boolean }
    }
    assert.equal(policy.runner?.enabled, false)
    assert.ok(existsSync(join(dir, 'clara', 'runner.json')))
    assert.ok(existsSync(join(dir, 'clara', 'adapter.json')))
  })
})

test('refuses an unselected --mcp-for target', () => {
  withConfigHome(() => {
    assert.throws(
      () => install(parseOptions(['install', '--opencode', '--mcp-for', 'claudecode'])),
      /not selected/
    )
  })
})

test('refuses a harness adapter that is not available yet', () => {
  withConfigHome(() => {
    assert.throws(
      () => install(parseOptions(['install', '--opencode', '--claudecode'])),
      /not available yet/
    )
  })
})
