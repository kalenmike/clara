import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { agentList, commandList, modelList, providerList, skillList } from '../src/catalog.ts'
import type { ClaudeCatalog } from '../src/sdk.ts'

const catalog: ClaudeCatalog = {
  provider: { id: 'anthropic', name: 'Anthropic' },
  models: [{ value: 'sonnet', name: 'Claude Sonnet', description: 'Balanced' }],
  agents: [],
  commands: [{ name: 'review', description: 'Review the diff' }],
  skills: [],
  plugins: [],
  terminalCommands: [],
}

const roots: string[] = []

function skillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clara-claude-skill-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Claude catalog mapping', () => {
  it('maps models with the resolved provider', () => {
    const result = modelList(catalog, '/tmp')
    expect(result.location).toEqual({ directory: '/tmp' })
    expect(result.data[0]).toMatchObject({
      id: 'sonnet',
      modelID: 'sonnet',
      providerID: 'anthropic',
      name: 'Claude Sonnet',
      capabilities: { tools: true },
      status: 'active',
      enabled: true,
    })
  })

  it('maps a non-Anthropic provider and model-specific capabilities', () => {
    const result = modelList(
      {
        ...catalog,
        provider: { id: 'ollama', name: 'Ollama' },
        models: [
          {
            value: 'gemma4:26b',
            name: 'Gemma 4 26B',
            resolvedModel: 'gemma4:26b',
            family: 'gemma4',
            capabilities: {
              tools: true,
              input: ['text', 'image'],
              output: ['text'],
              temperature: true,
            },
            limit: { context: 262_144, output: 4_096 },
            cost: [],
            status: 'active',
            enabled: true,
          },
        ],
      },
      '/tmp'
    )
    expect(result.data[0]).toMatchObject({
      id: 'gemma4:26b',
      providerID: 'ollama',
      canonical: 'gemma4:26b',
      family: 'gemma4',
      capabilities: { tools: true, input: ['text', 'image'] },
      limit: { context: 262_144, output: 4_096 },
    })
  })

  it('maps slash commands, hiding terminal-only commands', () => {
    const result = commandList(
      {
        ...catalog,
        commands: [
          { name: 'review', description: 'Review the diff' },
          { name: 'statusline', description: 'Terminal only' },
        ],
        terminalCommands: ['statusline'],
      },
      '/tmp'
    )
    expect(result.data).toEqual([{ name: 'review', description: 'Review the diff' }])
    expect(providerList(catalog.provider, '/tmp').data[0]).toMatchObject({
      id: 'anthropic',
      name: 'Anthropic',
      activation: 'enabled',
    })
    expect(providerList({ id: 'ollama', name: 'Ollama' }, '/tmp').data[0]).toMatchObject({
      id: 'ollama',
      name: 'Ollama',
    })
  })

  it('maps Claude subagent definitions as read-only agents', () => {
    const result = agentList(
      {
        ...catalog,
        agents: [{ name: 'Explore', description: 'Search the codebase', model: 'inherit' }],
      },
      '/tmp'
    )
    expect(result.data[0]).toMatchObject({
      id: 'Explore',
      name: 'Explore',
      description: 'Search the codebase',
      mode: 'subagent',
      hidden: false,
      request: {},
      permissions: [],
    })
  })

  it('merges live skill names with project SKILL.md files', () => {
    const root = skillRoot()
    const directory = join(root, '.claude', 'skills', 'reviewer')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'SKILL.md'),
      [
        '---',
        'name: reviewer',
        'description: Review changes carefully',
        '---',
        '',
        '# Reviewer',
        '',
      ].join('\n')
    )

    const result = skillList(
      {
        ...catalog,
        skills: [
          {
            id: 'builtin',
            name: 'builtin',
            description: 'Built-in skill',
            path: '',
            content: 'Built-in skill',
          },
        ],
      },
      root
    )

    expect(result.location).toEqual({ directory: root })
    expect(result.data).toContainEqual(
      expect.objectContaining({
        id: 'reviewer',
        name: 'reviewer',
        description: 'Review changes carefully',
        path: join(directory, 'SKILL.md'),
        autoinvoke: true,
      })
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({ id: 'builtin', description: 'Built-in skill', path: '' })
    )
  })

  it('marks a skill with disable-model-invocation as manual', () => {
    const root = skillRoot()
    const directory = join(root, '.claude', 'skills', 'manual')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      join(directory, 'SKILL.md'),
      ['---', 'name: manual', 'disable-model-invocation: true', '---', '', '# Manual', ''].join(
        '\n'
      )
    )

    const [skill] = skillList(catalog, root).data
    expect(skill).toMatchObject({ id: 'manual', autoinvoke: false })
  })

  it('reads user skills from CLAUDE_CONFIG_DIR', () => {
    const root = skillRoot()
    const directory = join(root, 'skills', 'user-skill')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'SKILL.md'), ['---', 'name: user-skill', '---', ''].join('\n'))

    const previous = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = root
    try {
      expect(skillList(catalog, join(root, 'project')).data).toContainEqual(
        expect.objectContaining({ id: 'user-skill', path: join(directory, 'SKILL.md') })
      )
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
    }
  })
})
