import { describe, expect, it } from 'vitest'
import { ANTHROPIC_PROVIDER, OLLAMA_PROVIDER, resolveClaudeProvider } from '../src/provider.ts'

describe('Claude provider resolution', () => {
  it('defaults to Anthropic for a first-party account', () => {
    expect(resolveClaudeProvider({ apiProvider: 'firstParty' })).toEqual(ANTHROPIC_PROVIDER)
    expect(resolveClaudeProvider({})).toEqual(ANTHROPIC_PROVIDER)
  })

  it('maps the built-in cloud providers', () => {
    expect(resolveClaudeProvider({ apiProvider: 'bedrock' })).toEqual({
      id: 'bedrock',
      name: 'Amazon Bedrock',
    })
    expect(resolveClaudeProvider({ apiProvider: 'vertex' })).toEqual({
      id: 'vertex',
      name: 'Google Vertex AI',
    })
    expect(resolveClaudeProvider({ apiProvider: 'foundry' })).toEqual({
      id: 'foundry',
      name: 'Microsoft Foundry',
    })
    expect(resolveClaudeProvider({ apiProvider: 'gateway' })).toEqual({
      id: 'gateway',
      name: 'Claude gateway',
    })
  })

  it('names a custom endpoint from its host', () => {
    expect(
      resolveClaudeProvider({
        apiProvider: 'firstParty',
        baseUrl: 'http://host.docker.internal:11434',
      })
    ).toEqual({ id: 'custom-endpoint', name: 'host.docker.internal:11434' })
  })

  it('honours an explicit override over every automatic source', () => {
    expect(
      resolveClaudeProvider({
        configured: { id: 'ollama', name: 'Ollama' },
        apiProvider: 'bedrock',
        baseUrl: 'http://host:11434',
      })
    ).toEqual(OLLAMA_PROVIDER)
  })

  it('kebab-cases providers it does not know yet', () => {
    expect(resolveClaudeProvider({ apiProvider: 'customEndpoint' })).toEqual({
      id: 'custom-endpoint',
      name: 'Custom Endpoint',
    })
  })
})
