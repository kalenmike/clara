import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  claudeEndpoint,
  discoverOllama,
  isCustomClaudeModel,
  ollamaDefaultModel,
  ollamaModels,
  ollamaTagsUrls,
  settingsEnvironment,
} from '../src/ollama.ts'

const tags = {
  models: [
    {
      name: 'gemma4:26b',
      details: { family: 'gemma4', context_length: 262_144 },
      capabilities: ['completion', 'vision', 'tools', 'thinking'],
    },
    {
      name: 'neuronet:mistral',
      details: { family: 'llama', context_length: 1_024_000 },
      capabilities: ['completion', 'tools'],
    },
    {
      name: 'qwen2.5vl:7b-q4_K_M',
      details: { family: 'qwen25vl', context_length: 128_000 },
      capabilities: ['completion', 'vision'],
    },
  ],
}

describe('Claude endpoint resolution', () => {
  it('prefers adapter config, then the environment, then user settings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clara-claude-settings-'))
    writeFileSync(
      join(directory, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'http://settings:11434',
          ANTHROPIC_MODEL: 'settings-model',
          ANTHROPIC_AUTH_TOKEN: 'settings-token',
        },
      })
    )
    const env = { CLAUDE_CONFIG_DIR: directory, ANTHROPIC_BASE_URL: 'http://env:11434' }
    expect(claudeEndpoint({ baseUrl: 'http://config:11434', model: 'config-model' }, env)).toEqual({
      baseUrl: 'http://config:11434',
      authToken: 'settings-token',
      model: 'config-model',
    })
    expect(claudeEndpoint({}, env).baseUrl).toBe('http://env:11434')
    expect(claudeEndpoint({}, { CLAUDE_CONFIG_DIR: directory })).toEqual({
      baseUrl: 'http://settings:11434',
      authToken: 'settings-token',
      model: 'settings-model',
    })
  })

  it('ignores missing or malformed settings', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clara-claude-settings-'))
    writeFileSync(join(directory, 'settings.json'), '{')
    expect(settingsEnvironment({ CLAUDE_CONFIG_DIR: directory })).toEqual({})
    expect(claudeEndpoint({}, { CLAUDE_CONFIG_DIR: directory })).toEqual({})
  })
})

describe('Ollama discovery', () => {
  it('builds root and path-relative tag URLs', () => {
    expect(ollamaTagsUrls('http://host:11434')).toEqual(['http://host:11434/api/tags'])
    expect(ollamaTagsUrls('http://host:11434/v1')).toEqual([
      'http://host:11434/api/tags',
      'http://host:11434/v1/api/tags',
    ])
    expect(ollamaTagsUrls('http://host:11434/ollama')).toContain(
      'http://host:11434/ollama/api/tags'
    )
  })

  it('reads /api/tags and normalizes the model rows', async () => {
    const found = await discoverOllama('http://host:11434/v1', {
      fetchImpl: async (input) => {
        if (String(input) !== 'http://host:11434/api/tags') {
          return new Response('not found', { status: 404 })
        }
        return new Response(JSON.stringify(tags), { status: 200 })
      },
    })
    expect(found).toMatchObject({
      baseUrl: 'http://host:11434',
      models: [
        { name: 'gemma4:26b', details: { family: 'gemma4', context_length: 262_144 } },
        { name: 'neuronet:mistral' },
        { name: 'qwen2.5vl:7b-q4_K_M' },
      ],
    })
  })

  it('returns undefined for a non-Ollama or unreachable endpoint', async () => {
    expect(
      await discoverOllama('http://host:11434', {
        fetchImpl: async () => new Response('not found', { status: 404 }),
      })
    ).toBeUndefined()
    expect(
      await discoverOllama('http://host:11434', {
        fetchImpl: async () => {
          throw new Error('offline')
        },
      })
    ).toBeUndefined()
    expect(await discoverOllama(undefined)).toBeUndefined()
  })
})

describe('Ollama model mapping', () => {
  const found = tags.models

  it('maps capabilities, context, and family', () => {
    const models = ollamaModels(found)
    expect(models[0]).toMatchObject({
      value: 'gemma4:26b',
      name: 'gemma4:26b',
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
    })
    expect(models[2]).toMatchObject({
      capabilities: { tools: false, input: ['text', 'image'] },
    })
  })

  it('keeps custom labels and adds rows the server does not report', () => {
    const models = ollamaModels(found, [
      { value: 'gemma4:26b', name: 'Gemma 4 26B', description: 'Local' },
      { value: 'local-alias', name: 'Local alias', resolvedModel: 'local-model' },
    ])
    expect(models[0]).toMatchObject({ name: 'Gemma 4 26B', description: 'Local' })
    expect(models.at(-1)).toMatchObject({
      value: 'local-alias',
      name: 'Local alias',
      resolvedModel: 'local-model',
    })
  })

  it('separates custom rows from built-in Claude models', () => {
    expect(isCustomClaudeModel({ value: 'sonnet', resolvedModel: 'claude-sonnet-5-5' })).toBe(false)
    expect(isCustomClaudeModel({ value: 'default', resolvedModel: 'claude-opus-5-5' })).toBe(false)
    expect(isCustomClaudeModel({ value: 'gemma4:26b', resolvedModel: 'gemma4:26b' })).toBe(true)
    expect(isCustomClaudeModel({ value: 'mistral-nemo:12b' })).toBe(true)
  })

  it('prefers a configured model that exists, then a tool-capable model', () => {
    expect(ollamaDefaultModel(found, 'neuronet:mistral')).toBe('neuronet:mistral')
    expect(ollamaDefaultModel(found, 'missing')).toBe('gemma4:26b')
    expect(
      ollamaDefaultModel([
        { name: 'vision-only', capabilities: ['completion', 'vision'] },
        { name: 'tool-model', capabilities: ['completion', 'tools'] },
      ])
    ).toBe('tool-model')
  })
})
