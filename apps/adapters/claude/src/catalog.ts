import type {
  ClaraAgentListOutput,
  ClaraCommandListOutput,
  ClaraModel,
  ClaraModelListOutput,
  ClaraProviderListOutput,
  ClaraReferenceListOutput,
  ClaraSkillListOutput,
} from '@clara/api-contract'
import type { ClaudeCatalog } from './sdk.ts'

const PROVIDER_ID = 'anthropic'
const DEFAULT_CONTEXT = 200_000
const DEFAULT_OUTPUT = 64_000

export function modelList(catalog: ClaudeCatalog, directory: string): ClaraModelListOutput {
  return {
    location: { directory },
    data: catalog.models.map((model): ClaraModel => {
      const id = model.value
      return {
        id,
        modelID: id,
        providerID: PROVIDER_ID,
        name: model.name,
        canonical: id,
        capabilities: {
          tools: true,
          input: ['text', 'image'],
          output: ['text'],
          temperature: false,
        },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: 'active',
        enabled: true,
        limit: { context: DEFAULT_CONTEXT, output: DEFAULT_OUTPUT },
      }
    }),
  }
}

export function providerList(directory: string): ClaraProviderListOutput {
  return {
    location: { directory },
    data: [
      {
        id: PROVIDER_ID,
        name: 'Anthropic',
        activation: 'enabled',
        package: 'claude-code',
      },
    ],
  }
}

/**
 * Claude's supportedAgents() lists subagent definitions, not primary agents.
 * Returning them as primary would make the composer select one as the main
 * thread agent, so Clara keeps the list empty and uses Claude's own default.
 */
export function agentList(directory: string): ClaraAgentListOutput {
  return { location: { directory }, data: [] }
}

export function commandList(catalog: ClaudeCatalog, directory: string): ClaraCommandListOutput {
  return {
    location: { directory },
    data: catalog.commands.map((command) => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
    })),
  }
}

export function skillList(directory: string): ClaraSkillListOutput {
  return { location: { directory }, data: [] }
}

export function referenceList(directory: string): ClaraReferenceListOutput {
  return { location: { directory }, data: [] }
}
