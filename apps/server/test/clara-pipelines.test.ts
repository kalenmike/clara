import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Pipeline } from '@clara/shared-types'
import { ClaraManagement } from '../src/clara/index.ts'
import { OpenCodeClient } from '../src/opencode.ts'
import type { SettingsStore } from '../src/store/settings.ts'

const tempDirs: string[] = []
const previousConfigDir = process.env.CLARA_CONFIG_DIR

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-pipeline-catalog-'))
  tempDirs.push(dir)
  return dir
}

function pipeline(id: string, version = 1): Pipeline {
  return {
    schemaVersion: 1,
    id,
    name: `Pipeline ${id}`,
    version,
    stages: [
      {
        id: 'spec',
        title: 'Spec',
        phase: 'contract',
        agent: '001',
        role: 'worker',
        instructions: 'Write the spec.',
      },
      {
        id: 'close',
        title: 'Close',
        phase: 'close',
        agent: 'judge',
        role: 'closer',
        instructions: 'Close the request.',
      },
    ],
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (previousConfigDir === undefined) delete process.env.CLARA_CONFIG_DIR
  else process.env.CLARA_CONFIG_DIR = previousConfigDir
})

function management(): { clara: ClaraManagement; close: () => void } {
  const dir = tempDir()
  const clara = new ClaraManagement({
    config: { ledgerDbPath: join(dir, 'ledger.db') },
    // The catalog only reads files; this test does not need a live settings DB.
    settings: {} as SettingsStore,
    openCode: new OpenCodeClient('http://127.0.0.1:1'),
    canProxy: () => false,
    log: () => undefined,
  })
  return { clara, close: () => undefined }
}

describe('ClaraManagement.pipelineCatalog', () => {
  it('returns the built-ins and the custom files separately', () => {
    const { clara, close } = management()
    const configDir = tempDir()
    process.env.CLARA_CONFIG_DIR = configDir
    mkdirSync(join(configDir, 'pipelines'), { recursive: true })
    writeFileSync(
      join(configDir, 'pipelines', 'research.json'),
      JSON.stringify(pipeline('research'))
    )

    const catalog = clara.pipelineCatalog()
    close()

    expect(catalog.directory).toBe(join(configDir, 'pipelines'))
    expect(catalog.builtins.map((entry) => entry.id)).toEqual(['software', 'content'])
    expect(catalog.custom.map((entry) => entry.pipeline.id)).toEqual(['research'])
    expect(catalog.errors).toEqual([])
  })

  it('keeps an overridden built-in visible beside the custom replacement', () => {
    const { clara, close } = management()
    const configDir = tempDir()
    process.env.CLARA_CONFIG_DIR = configDir
    mkdirSync(join(configDir, 'pipelines'), { recursive: true })
    writeFileSync(
      join(configDir, 'pipelines', 'software.json'),
      JSON.stringify(pipeline('software', 2))
    )

    const catalog = clara.pipelineCatalog()
    close()

    expect(catalog.builtins.find((entry) => entry.id === 'software')?.version).toBe(1)
    expect(catalog.custom.find((entry) => entry.pipeline.id === 'software')?.pipeline.version).toBe(
      2
    )
  })

  it('reports a file that cannot be validated', () => {
    const { clara, close } = management()
    const configDir = tempDir()
    process.env.CLARA_CONFIG_DIR = configDir
    mkdirSync(join(configDir, 'pipelines'), { recursive: true })
    writeFileSync(join(configDir, 'pipelines', 'broken.json'), '{')

    const catalog = clara.pipelineCatalog()
    close()

    expect(catalog.custom).toEqual([])
    expect(catalog.errors).toHaveLength(1)
    expect(catalog.errors[0]?.path).toContain('broken.json')
  })
})
