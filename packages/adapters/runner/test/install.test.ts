import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { installRunner, uninstallRunner } from '../src/install.ts'
import { manifestPath } from '../src/manifest.ts'
import { runnerConfigPath } from '../src/config.ts'

async function withConfigHome(run: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'clara-adapter-install-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = dir
  try {
    await run(dir)
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

test('writes the shared runner config without installing a service', async () => {
  await withConfigHome(async () => {
    installRunner({ noService: true, explicit: true })
    expect(existsSync(runnerConfigPath())).toBe(true)
    expect(existsSync(manifestPath())).toBe(true)
    const config = JSON.parse(readFileSync(runnerConfigPath(), 'utf8')) as {
      workspace: string
    }
    expect(config.workspace).toBe(process.cwd())
  })
})

test('skips the service when the build has no runner entry', async () => {
  await withConfigHome(async () => {
    const result = installRunner({ entry: join(tmpdir(), 'missing-clara-runner.js') })
    expect(result.manifest.service).toBe('none')
    expect(result.actions).toContain('runner service skipped')
    expect(result.warnings.join(' ')).toContain('clara runner start')
    expect(existsSync(runnerConfigPath())).toBe(true)
  })
})

test('still fails an explicit runner install without an entry', async () => {
  await withConfigHome(async () => {
    expect(() =>
      installRunner({
        entry: join(tmpdir(), 'missing-clara-runner.js'),
        explicit: true,
      })
    ).toThrow(/clara runner start/)
  })
})

test('removes the runner config on uninstall', async () => {
  await withConfigHome(async () => {
    installRunner({ noService: true, explicit: true })
    uninstallRunner()
    expect(existsSync(runnerConfigPath())).toBe(false)
    expect(existsSync(manifestPath())).toBe(false)
  })
})
