import type { ClaraAgent } from '@clara/api-contract'
import { notifySettingChanged } from '@/lib/setting-events'

export type DefaultAgentMode = 'last' | 'fixed'

export type DefaultAgentSettings = {
  mode: DefaultAgentMode
  /** Agent ID used when the mode is fixed. */
  agent: string | null
}

export type AgentOption = Pick<ClaraAgent, 'id' | 'hidden' | 'mode'>

export const AGENT_DEFAULT_KEY = 'clara.defaultAgent'
export const LAST_AGENT_KEY = 'clara.lastAgent'

export const DEFAULT_AGENT_SETTINGS: DefaultAgentSettings = {
  mode: 'last',
  agent: null,
}

let cachedSettings: DefaultAgentSettings | null = null
const listeners = new Set<() => void>()

function normalize(value: unknown): DefaultAgentSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_SETTINGS }

  const record = value as Record<string, unknown>
  return {
    mode: record.mode === 'fixed' ? 'fixed' : 'last',
    agent: typeof record.agent === 'string' && record.agent.length > 0 ? record.agent : null,
  }
}

export function readDefaultAgent(): DefaultAgentSettings {
  if (cachedSettings) return cachedSettings

  try {
    const raw = window.localStorage.getItem(AGENT_DEFAULT_KEY)
    cachedSettings = raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_AGENT_SETTINGS }
  } catch {
    cachedSettings = { ...DEFAULT_AGENT_SETTINGS }
  }

  return cachedSettings
}

export function saveDefaultAgent(settings: DefaultAgentSettings): void {
  cachedSettings = normalize(settings)

  try {
    window.localStorage.setItem(AGENT_DEFAULT_KEY, JSON.stringify(cachedSettings))
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
  notifySettingChanged(AGENT_DEFAULT_KEY)
}

export function readLastAgent(): string | null {
  try {
    const value = window.localStorage.getItem(LAST_AGENT_KEY)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function saveLastAgent(agent: string): void {
  if (!agent || readLastAgent() === agent) return

  try {
    window.localStorage.setItem(LAST_AGENT_KEY, agent)
  } catch {
    // Storage can be unavailable in private browsing; the next event retries.
  }

  for (const listener of listeners) listener()
  notifySettingChanged(LAST_AGENT_KEY)
}

export function subscribeAgentDefault(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== AGENT_DEFAULT_KEY && event.key !== LAST_AGENT_KEY) return
    cachedSettings = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Hidden and subagent agents cannot be a session's primary agent. */
export function isSelectableAgent(
  agents: readonly AgentOption[] | undefined,
  agent: string
): boolean {
  if (!agents) return true
  return agents.some((item) => item.id === agent && !item.hidden && item.mode !== 'subagent')
}

/**
 * Pick the agent for a new message draft. Fixed mode wins when its agent still
 * exists, otherwise Clara falls back to the last agent the person selected.
 * An undefined `agents` list means the catalog has not loaded yet, so the stored
 * choice is trusted rather than dropped.
 */
export function resolveDefaultAgent({
  settings,
  lastAgent,
  fallbackAgent,
  agents,
}: {
  settings: DefaultAgentSettings
  lastAgent: string | null
  fallbackAgent?: string | null
  agents?: readonly AgentOption[]
}): string | undefined {
  const select = (agent: string | null | undefined): string | undefined =>
    agent && isSelectableAgent(agents, agent) ? agent : undefined

  if (settings.mode === 'fixed') {
    const fixed = select(settings.agent)
    if (fixed) return fixed
  }

  return select(lastAgent) ?? select(fallbackAgent)
}
