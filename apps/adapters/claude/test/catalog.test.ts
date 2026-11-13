import { describe, expect, it } from 'vitest'
import { commandList, modelList, providerList } from '../src/catalog.ts'

const catalog = {
  models: [{ value: 'sonnet', name: 'Claude Sonnet', description: 'Balanced' }],
  agents: [],
  commands: [{ name: 'review', description: 'Review the diff' }],
  skills: [],
}

describe('Claude catalog mapping', () => {
  it('maps models with the anthropic provider', () => {
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

  it('maps slash commands and the provider', () => {
    expect(commandList(catalog, '/tmp').data).toEqual([
      { name: 'review', description: 'Review the diff' },
    ])
    expect(providerList('/tmp').data[0]).toMatchObject({
      id: 'anthropic',
      activation: 'enabled',
    })
  })
})
