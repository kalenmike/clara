import type {
  ClaraAgentListOutput,
  ClaraCommandListOutput,
  ClaraModel,
  ClaraModelListOutput,
  ClaraProviderListOutput,
  ClaraReferenceListOutput,
  ClaraSkill,
  ClaraSkillListOutput,
} from '@clara/api-contract'
import type { ClaudeSkillEntry } from './catalog-merge.ts'
import type { ClaudeCatalog } from './sdk.ts'
import type { ClaudeProvider } from './provider.ts'
import { discoverSkills } from './skills.ts'

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
 * Clara exposes them read-only: they run through the Task tool and cannot be
 * selected as the session's main-thread agent.
 */
export function agentList(catalog: ClaudeCatalog, directory: string): ClaraAgentListOutput {
  return {
    location: { directory },
    data: catalog.agents.map((agent) => ({
      id: agent.name,
      name: agent.name,
      request: { settings: {}, headers: {}, body: {} },
      ...(agent.description ? { description: agent.description } : {}),
      mode: 'subagent' as const,
      hidden: false,
      permissions: [],
    })),
  }
}

export function commandList(catalog: ClaudeCatalog, directory: string): ClaraCommandListOutput {
  const terminal = new Set(catalog.terminalCommands)
  return {
    location: { directory },
    data: catalog.commands
      .filter((command) => !terminal.has(command.name))
      .map((command) => ({
        name: command.name,
        ...(command.description ? { description: command.description } : {}),
      })),
  }
}

/**
 * Merge the skill names Claude reported in a live turn with the SKILL.md files
 * on disk. Files win because they carry the path and full content.
 */
export function skillList(catalog: ClaudeCatalog, directory: string): ClaraSkillListOutput {
  const byID = new Map<string, ClaudeSkillEntry>()
  for (const skill of catalog.skills) byID.set(skill.id, skill)
  for (const skill of discoverSkills(directory, catalog.plugins)) byID.set(skill.id, skill)
  return {
    location: { directory },
    data: [...byID.values()].map((skill): ClaraSkill => ({
      id: skill.id,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.autoinvoke !== undefined ? { autoinvoke: skill.autoinvoke } : {}),
      path: skill.path,
      content: skill.content,
    })),
  }
}

export function referenceList(directory: string): ClaraReferenceListOutput {
  return { location: { directory }, data: [] }
}
