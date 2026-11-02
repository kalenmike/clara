import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setAgentEnabled, syncClaraAgentVisibility } from '../src/clara/agents.ts'

const ENABLED = `---\ndescription: "Clara"\nmode: "primary"\nsteps: 20\n---\n\nYou are Clara.\n`
const DISABLED = `---\ndescription: "Clara"\nmode: "primary"\nsteps: 20\ndisabled: true\n---\n\nYou are Clara.\n`

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type Fixture = {
  agentsDir: string
  manifestPath: string
}

function fixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'clara-agents-'))
  tempDirs.push(dir)
  const agentsDir = join(dir, 'agents')
  const manifestPath = join(agentsDir, '.clara-agents.json')
  mkdirSync(agentsDir, { recursive: true })
  return { agentsDir, manifestPath }
}

function install(options: Fixture, agents: Record<string, string>): void {
  const hashes: Record<string, string> = {}
  for (const [id, content] of Object.entries(agents)) {
    writeFileSync(join(options.agentsDir, `${id}.md`), content)
    hashes[id] = hash(content)
  }
  writeFileSync(options.manifestPath, `${JSON.stringify({ agents: hashes }, null, 2)}\n`)
}

function read(options: Fixture, id: string): string {
  return readFileSync(join(options.agentsDir, `${id}.md`), 'utf8')
}

function manifest(options: Fixture): { agents: Record<string, string> } {
  return JSON.parse(readFileSync(options.manifestPath, 'utf8')) as {
    agents: Record<string, string>
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('setAgentEnabled', () => {
  it('adds and removes the disabled field without touching the body', () => {
    expect(setAgentEnabled(ENABLED, false)).toBe(DISABLED)
    expect(setAgentEnabled(DISABLED, true)).toBe(ENABLED)
    expect(setAgentEnabled(DISABLED, false)).toBe(DISABLED)
    expect(setAgentEnabled(ENABLED, true)).toBe(ENABLED)
  })

  it('handles nested permission blocks and a markdown body', () => {
    const nested = `---\ndescription: "Clara"\nmode: "primary"\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: "deny"\n---\n\n# Clara\n\nDo not edit.\n`
    const hidden = setAgentEnabled(nested, false)

    expect(hidden).toContain('    effect: "deny"\ndisabled: true\n---')
    expect(hidden).toContain('\n# Clara\n\nDo not edit.\n')
    expect(setAgentEnabled(hidden, true)).toBe(nested)
  })

  it('rejects a file without frontmatter', () => {
    expect(() => setAgentEnabled('You are Clara.\n', false)).toThrow('no frontmatter')
  })
})

describe('syncClaraAgentVisibility', () => {
  it('disables every installed agent and records the new hashes', () => {
    const options = fixture()
    install(options, { clara: ENABLED, '001': ENABLED })

    const result = syncClaraAgentVisibility(false, options)

    expect(result).toEqual({ updated: ['clara', '001'], skipped: [], missingManifest: false })
    expect(read(options, 'clara')).toBe(DISABLED)
    expect(read(options, '001')).toBe(DISABLED)
    expect(manifest(options).agents).toEqual({ clara: hash(DISABLED), '001': hash(DISABLED) })

    expect(syncClaraAgentVisibility(false, options)).toEqual({
      updated: [],
      skipped: [],
      missingManifest: false,
    })
  })

  it('restores the original content when management is enabled again', () => {
    const options = fixture()
    install(options, { clara: ENABLED })
    syncClaraAgentVisibility(false, options)

    const result = syncClaraAgentVisibility(true, options)

    expect(result).toEqual({ updated: ['clara'], skipped: [], missingManifest: false })
    expect(read(options, 'clara')).toBe(ENABLED)
    expect(manifest(options).agents.clara).toBe(hash(ENABLED))
  })

  it('leaves a file edited after installation untouched', () => {
    const options = fixture()
    const edited = ENABLED.replace('You are Clara.', 'My edited prompt.')
    install(options, { clara: ENABLED, '001': ENABLED })
    writeFileSync(join(options.agentsDir, 'clara.md'), edited)

    const result = syncClaraAgentVisibility(false, options)

    expect(result).toEqual({ updated: ['001'], skipped: ['clara'], missingManifest: false })
    expect(read(options, 'clara')).toBe(edited)
    expect(read(options, '001')).toBe(DISABLED)
    expect(manifest(options).agents.clara).toBe(hash(ENABLED))
  })

  it('does nothing when the installer has not run', () => {
    const options = fixture()

    expect(syncClaraAgentVisibility(false, options)).toEqual({
      updated: [],
      skipped: [],
      missingManifest: true,
    })
  })

  it('ignores manifest entries that are not safe file names', () => {
    const options = fixture()
    const outside = join(options.agentsDir, '..', 'escape.md')
    writeFileSync(outside, ENABLED)
    writeFileSync(join(options.agentsDir, 'clara.md'), ENABLED)
    writeFileSync(
      options.manifestPath,
      JSON.stringify({ agents: { '../escape': hash(ENABLED), clara: hash(ENABLED) } })
    )

    const result = syncClaraAgentVisibility(false, options)

    expect(result.updated).toEqual(['clara'])
    expect(readFileSync(outside, 'utf8')).toBe(ENABLED)
  })
})
