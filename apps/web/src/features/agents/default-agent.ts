import type { ClaraAgent } from '@clara/api-contract'
import { notifySettingChanged } from '@/lib/setting-events'

export type DefaultAgentMode = 'last' | 'fixed'

export type DefaultAgentSettings = {
  mode: DefaultAgentMode
  /** Agent ID used when the mode is fixed. */
  agent: string | null
}

type DefaultAgentState = {
  version: 2
  harnesses: Record<string, DefaultAgentSettings>
}

type LastAgentState = {
  version: 2
  harnesses: Record<string, string>
}

export type AgentOption = Pick<ClaraAgent, 'id' | 'hidden' | 'mode'>

export const AGENT_DEFAULT_KEY = 'clara.defaultAgent'
export const LAST_AGENT_KEY = 'clara.lastAgent'

export const DEFAULT_AGENT_SETTINGS: DefaultAgentSettings = {
  mode: 'last',
  agent: null,
}

let cachedSettings: DefaultAgentState | null = null
let cachedLastAgents: LastAgentState | null = null
const listeners = new Set<() => void>()

function normalizeSettings(value: unknown): DefaultAgentSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_SETTINGS }

  const record = value as Record<string, unknown>
  return {
    mode: record.mode === 'fixed' ? 'fixed' : 'last',
    agent: typeof record.agent === 'string' && record.agent.length > 0 ? record.agent : null,
  }
}

function normalizeSettingsState(value: unknown): DefaultAgentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 2, harnesses: {} }
  }
  const record = value as Record<string, unknown>
  if (record.version !== 2 || !record.harnesses || typeof record.harnesses !== 'object') {
    return { version: 2, harnesses: {} }
  }

  const harnesses: Record<string, DefaultAgentSettings> = {}
  for (const [harnessID, settings] of Object.entries(record.harnesses)) {
    const trimmed = harnessID.trim()
    if (!trimmed) continue
    harnesses[trimmed] = normalizeSettings(settings)
  }
  return { version: 2, harnesses }
}

function normalizeLastAgentState(value: unknown): LastAgentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 2, harnesses: {} }
  }
  const record = value as Record<string, unknown>
  if (record.version !== 2 || !record.harnesses || typeof record.harnesses !== 'object') {
    return { version: 2, harnesses: {} }
  }

  const harnesses: Record<string, string> = {}
  for (const [harnessID, agent] of Object.entries(record.harnesses)) {
    const trimmed = harnessID.trim()
    if (!trimmed || typeof agent !== 'string' || agent.length === 0) continue
    harnesses[trimmed] = agent
  }
  return { version: 2, harnesses }
}

function readSettingsState(): DefaultAgentState {
  if (cachedSettings) return cachedSettings

  try {
    const raw = window.localStorage.getItem(AGENT_DEFAULT_KEY)
    cachedSettings = raw ? normalizeSettingsState(JSON.parse(raw)) : { version: 2, harnesses: {} }
  } catch {
    cachedSettings = { version: 2, harnesses: {} }
  }

  return cachedSettings
}

function readLastAgentStateInternal(): LastAgentState {
  if (cachedLastAgents) return cachedLastAgents

  try {
    const raw = window.localStorage.getItem(LAST_AGENT_KEY)
    cachedLastAgents = raw
      ? normalizeLastAgentState(JSON.parse(raw))
      : { version: 2, harnesses: {} }
  } catch {
    cachedLastAgents = { version: 2, harnesses: {} }
  }

  return cachedLastAgents
}

export function readDefaultAgentState(): unknown {
  return readSettingsState()
}

export function readLastAgentState(): unknown {
  return readLastAgentStateInternal()
}

export function saveDefaultAgentState(value: unknown): void {
  cachedSettings = normalizeSettingsState(value)
  try {
    window.localStorage.setItem(AGENT_DEFAULT_KEY, JSON.stringify(cachedSettings))
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }
  for (const listener of listeners) listener()
  notifySettingChanged(AGENT_DEFAULT_KEY)
}

export function saveLastAgentState(value: unknown): void {
  cachedLastAgents = normalizeLastAgentState(value)
  try {
    window.localStorage.setItem(LAST_AGENT_KEY, JSON.stringify(cachedLastAgents))
  } catch {
    // Storage can be unavailable in private browsing; the next event retries.
  }
  for (const listener of listeners) listener()
  notifySettingChanged(LAST_AGENT_KEY)
}

export function readDefaultAgent(harnessID: string | undefined): DefaultAgentSettings {
  if (!harnessID) return DEFAULT_AGENT_SETTINGS
  return readSettingsState().harnesses[harnessID] ?? DEFAULT_AGENT_SETTINGS
}

export function saveDefaultAgent(
  harnessID: string | undefined,
  settings: DefaultAgentSettings
): void {
  if (!harnessID) return
  const current = readSettingsState()
  const next: DefaultAgentState = {
    version: 2,
    harnesses: { ...current.harnesses, [harnessID]: normalizeSettings(settings) },
  }
  cachedSettings = next

  try {
    window.localStorage.setItem(AGENT_DEFAULT_KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory choice.
  }

  for (const listener of listeners) listener()
  notifySettingChanged(AGENT_DEFAULT_KEY)
}

export function readLastAgent(harnessID: string | undefined): string | null {
  if (!harnessID) return null
  return readLastAgentStateInternal().harnesses[harnessID] ?? null
}

export function saveLastAgent(harnessID: string | undefined, agent: string): void {
  if (!harnessID || !agent) return
  const current = readLastAgentStateInternal()
  if (current.harnesses[harnessID] === agent) return

  const next: LastAgentState = {
    version: 2,
    harnesses: { ...current.harnesses, [harnessID]: agent },
  }
  cachedLastAgents = next

  try {
    window.localStorage.setItem(LAST_AGENT_KEY, JSON.stringify(next))
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
    cachedLastAgents = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Hidden and subagent agents cannot be a session's primary agent. */
export function isPrimaryAgent(agent: AgentOption): boolean {
  return !agent.hidden && agent.mode !== 'subagent'
}

/** A visible subagent runs only through the harness's delegation tool. */
export function isSubagentAgent(agent: AgentOption): boolean {
  return !agent.hidden && agent.mode === 'subagent'
}

export function primaryAgents<T extends AgentOption>(agents: readonly T[] | undefined): T[] {
  return (agents ?? []).filter(isPrimaryAgent)
}

export function subagents<T extends AgentOption>(agents: readonly T[] | undefined): T[] {
  return (agents ?? []).filter(isSubagentAgent)
}

/** Hidden and subagent agents cannot be a session's primary agent. */
export function isSelectableAgent(
  agents: readonly AgentOption[] | undefined,
  agent: string
): boolean {
  if (!agents) return true
  return agents.some((item) => item.id === agent && isPrimaryAgent(item))
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
