import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('uninstall-clara-plugin', () => {
  it('removes every management artifact with --purge', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-uninstall-'))
    dirs.push(dir)
    const opencode = join(dir, 'opencode')
    const plugins = join(opencode, 'plugins')
    const agents = join(opencode, 'agents')
    const claraDir = join(dir, 'clara')
    mkdirSync(plugins, { recursive: true })
    mkdirSync(agents, { recursive: true })
    mkdirSync(claraDir, { recursive: true })

    symlinkSync(join(repoRoot, 'plugins', 'clara'), join(plugins, 'clara'), 'dir')
    const agent = join(agents, 'clara.md')
    writeFileSync(agent, 'agent body', 'utf8')
    const hash = createHash('sha256').update('agent body').digest('hex')
    writeFileSync(join(agents, '.clara-agents.json'), JSON.stringify({ agents: { clara: hash } }))

    const ledger = join(claraDir, 'ledger.db')
    const sidecar = join(claraDir, 'ledger-alerts.db')
    writeFileSync(ledger, 'ledger')
    writeFileSync(sidecar, 'alerts')

    const serverDbPath = join(claraDir, 'clara.db')
    const serverDb = new Database(serverDbPath)
    serverDb.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE ledger_alert_state (id INTEGER PRIMARY KEY, cursor INTEGER NOT NULL);
      CREATE TABLE ledger_alert_delivery (key TEXT PRIMARY KEY, delivered_at INTEGER NOT NULL);
      INSERT INTO settings (key, value) VALUES ('management.enabled', 'true');
    `)
    serverDb.close()

    execFileSync(process.execPath, ['scripts/uninstall-clara-plugin.mjs', '--purge', '--yes'], {
      cwd: repoRoot,
      env: { ...process.env, XDG_CONFIG_HOME: dir },
      stdio: 'pipe',
    })

    expect(existsSync(join(plugins, 'clara'))).toBe(false)
    expect(existsSync(agent)).toBe(false)
    expect(existsSync(join(agents, '.clara-agents.json'))).toBe(false)
    expect(existsSync(ledger)).toBe(false)
    expect(existsSync(sidecar)).toBe(false)

    const remaining = new Database(serverDbPath, { readonly: true })
    try {
      expect(
        remaining.prepare('SELECT 1 FROM settings WHERE key = ?').get('management.enabled')
      ).toBeUndefined()
      expect(
        remaining
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ledger_alert%'"
          )
          .all()
      ).toEqual([])
    } finally {
      remaining.close()
    }
  })

  it('leaves edited agent files alone without --force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-uninstall-'))
    dirs.push(dir)
    const opencode = join(dir, 'opencode')
    const plugins = join(opencode, 'plugins')
    const agents = join(opencode, 'agents')
    mkdirSync(plugins, { recursive: true })
    mkdirSync(agents, { recursive: true })

    symlinkSync(join(repoRoot, 'plugins', 'clara'), join(plugins, 'clara'), 'dir')
    const agent = join(agents, 'clara.md')
    writeFileSync(agent, 'edited by hand', 'utf8')
    writeFileSync(
      join(agents, '.clara-agents.json'),
      JSON.stringify({ agents: { clara: 'not-the-current-hash' } })
    )

    const result = spawnSync(process.execPath, ['scripts/uninstall-clara-plugin.mjs', '--yes'], {
      cwd: repoRoot,
      env: { ...process.env, XDG_CONFIG_HOME: dir },
      stdio: 'pipe',
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(existsSync(join(plugins, 'clara'))).toBe(false)
    expect(existsSync(agent)).toBe(true)
    expect(existsSync(join(agents, '.clara-agents.json'))).toBe(true)
    expect(result.stderr).toContain('was edited after installation')
  })
})
