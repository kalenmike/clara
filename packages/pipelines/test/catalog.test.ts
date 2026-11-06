import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { builtinCatalog, catalogPipelines, loadPipeline, type Pipeline } from '../src/index.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clara-pipelines-'))
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
})

describe('pipeline catalog', () => {
  it('always exposes the shipped presets', () => {
    const builtins = builtinCatalog()
    expect(builtins.errors).toEqual([])
    expect(builtins.pipelines.map((entry) => entry.pipeline.id)).toEqual(['software', 'content'])
    expect(builtins.pipelines.every((entry) => entry.source === 'builtin')).toBe(true)
  })

  it('loads a custom file beside the presets', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'research.json'), JSON.stringify(pipeline('research')))
    const catalog = catalogPipelines(dir)

    expect(catalog.pipelines.map((entry) => entry.pipeline.id)).toEqual([
      'software',
      'content',
      'research',
    ])
    expect(catalog.pipelines.find((entry) => entry.pipeline.id === 'research')?.source).toBe('file')
    expect(catalog.errors).toEqual([])
  })

  it('lets a custom file override a preset without changing the shipped list', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'software.json'), JSON.stringify(pipeline('software', 2)))
    const catalog = catalogPipelines(dir)

    const effective = catalog.pipelines.find((entry) => entry.pipeline.id === 'software')
    expect(effective?.source).toBe('file')
    expect(effective?.pipeline.version).toBe(2)
    expect(builtinCatalog().pipelines[0].pipeline.version).toBe(1)
  })

  it('reports invalid files and duplicate ids', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'broken.json'), '{')
    writeFileSync(join(dir, 'a.json'), JSON.stringify(pipeline('research')))
    writeFileSync(join(dir, 'b.json'), JSON.stringify(pipeline('research')))

    const catalog = catalogPipelines(dir)
    expect(catalog.pipelines.find((entry) => entry.pipeline.id === 'research')?.source).toBe('file')
    expect(catalog.errors).toHaveLength(2)
    expect(catalog.errors.some((error) => error.path?.endsWith('broken.json'))).toBe(true)
    expect(catalog.errors.some((error) => error.errors[0]?.includes('duplicate pipeline id'))).toBe(
      true
    )
  })

  it('loads by id and explains a missing pipeline', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'research.json'), JSON.stringify(pipeline('research')))
    expect(loadPipeline('research', dir).pipeline.version).toBe(1)
    expect(() => loadPipeline('missing', dir)).toThrow('Available: software, content, research')
  })
})
