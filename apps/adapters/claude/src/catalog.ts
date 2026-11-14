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
import type { ClaudeProvider } from './provider.ts'

const DEFAULT_CONTEXT = 200_000
const DEFAULT_OUTPUT = 64_000

export function modelList(catalog: ClaudeCatalog, directory: string): ClaraModelListOutput {
  const providerID = catalog.provider.id
  return {
    location: { directory },
    data: catalog.models.map((model): ClaraModel => {
      const id = model.value
      return {
        id,
        modelID: id,
        providerID,
        name: model.name,
        canonical: model.resolvedModel ?? id,
        ...(model.family ? { family: model.family } : {}),
        capabilities: model.capabilities ?? {
          tools: true,
          input: ['text', 'image'],
          output: ['text'],
          temperature: false,
        },
        variants: [],
        time: { released: 0 },
        cost: model.cost ?? [],
        status: model.status ?? 'active',
        enabled: model.enabled ?? true,
        limit: model.limit ?? { context: DEFAULT_CONTEXT, output: DEFAULT_OUTPUT },
      }
    }),
  }
}

export function providerList(provider: ClaudeProvider, directory: string): ClaraProviderListOutput {
  return {
    location: { directory },
    data: [
      {
        id: provider.id,
        name: provider.name,
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
