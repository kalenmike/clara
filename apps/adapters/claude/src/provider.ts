import type { ClaudeProviderConfig } from './config.ts'

export type ClaudeProvider = {
  id: string
  name: string
}

const API_PROVIDERS: Record<string, ClaudeProvider> = {
  firstParty: { id: 'anthropic', name: 'Anthropic' },
  bedrock: { id: 'bedrock', name: 'Amazon Bedrock' },
  vertex: { id: 'vertex', name: 'Google Vertex AI' },
  foundry: { id: 'foundry', name: 'Microsoft Foundry' },
  anthropicAws: { id: 'anthropic-aws', name: 'Claude on AWS' },
  anthropicGoogleCloud: { id: 'anthropic-google-cloud', name: 'Claude on Google Cloud' },
  mantle: { id: 'mantle', name: 'Mantle' },
  gateway: { id: 'gateway', name: 'Claude gateway' },
}

export const ANTHROPIC_PROVIDER: ClaudeProvider = API_PROVIDERS.firstParty!
export const OLLAMA_PROVIDER: ClaudeProvider = { id: 'ollama', name: 'Ollama' }

/**
 * Claude Code exposes one active API backend per process. Resolve that backend
 * from the adapter override first, then the CLI's reported provider, then the
 * custom endpoint configured for the process.
 */
export function resolveClaudeProvider(input: {
  configured?: ClaudeProviderConfig
  apiProvider?: string
  baseUrl?: string
}): ClaudeProvider {
  const configured = input.configured?.id?.trim()
  if (configured) {
    return { id: configured, name: input.configured?.name?.trim() || configured }
  }

  const apiProvider = input.apiProvider?.trim()
  if (apiProvider) {
    const known = API_PROVIDERS[apiProvider]
    if (known) {
      if (known.id === ANTHROPIC_PROVIDER.id && input.baseUrl) {
        return customEndpoint(input.baseUrl)
      }
      return known
    }
    return { id: kebab(apiProvider), name: words(apiProvider) }
  }

  if (input.baseUrl) return customEndpoint(input.baseUrl)
  return ANTHROPIC_PROVIDER
}

function customEndpoint(baseUrl: string): ClaudeProvider {
  try {
    const host = new URL(baseUrl).host
    return host
      ? { id: 'custom-endpoint', name: host }
      : { id: 'custom-endpoint', name: 'Custom endpoint' }
  } catch {
    return { id: 'custom-endpoint', name: 'Custom endpoint' }
  }
}

function kebab(value: string): string {
  return words(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function words(value: string): string {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
