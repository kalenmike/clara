import { describe, expect, it } from 'vitest'
import { commandList, modelList, providerList } from '../src/catalog.ts'

const catalog = {
  provider: { id: 'anthropic', name: 'Anthropic' },
  models: [{ value: 'sonnet', name: 'Claude Sonnet', description: 'Balanced' }],
  agents: [],
  commands: [{ name: 'review', description: 'Review the diff' }],
  skills: [],
}

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

  it('maps slash commands and the provider', () => {
    expect(commandList(catalog, '/tmp').data).toEqual([
      { name: 'review', description: 'Review the diff' },
    ])
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
})
