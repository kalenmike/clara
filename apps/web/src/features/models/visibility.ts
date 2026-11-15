import type { ClaraModel } from '@clara/api-contract'
import { notifySettingChanged } from '@/lib/setting-events'

export const HIDDEN_MODELS_KEY = 'clara.hiddenModels'

/** The hidden providers and models for one harness. */
export type HiddenModels = {
  providers: string[]
  models: string[]
}

/** Per-harness visibility. There is no global default harness. */
export type HiddenModelsState = {
  version: 2
  harnesses: Record<string, HiddenModels>
}

export type PriceFilter = 'all' | 'free' | 'paid'

const MAX_ENTRIES = 5_000

let cached: HiddenModelsState | null = null
const listeners = new Set<() => void>()

const EMPTY_HIDDEN_MODELS: HiddenModels = { providers: [], models: [] }

export function emptyHiddenModels(): HiddenModels {
  return EMPTY_HIDDEN_MODELS
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= MAX_ENTRIES) break
  }
  return result
}

function normalizeGroup(value: unknown): HiddenModels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyHiddenModels()
  const record = value as Record<string, unknown>
  return {
    providers: normalizeList(record.providers),
    models: normalizeList(record.models),
  }
}

function normalizeState(value: unknown): HiddenModelsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { version: 2, harnesses: {} }
  }
  const record = value as Record<string, unknown>
  if (record.version !== 2 || !record.harnesses || typeof record.harnesses !== 'object') {
    return { version: 2, harnesses: {} }
  }

  const harnesses: Record<string, HiddenModels> = {}
  for (const [harnessID, group] of Object.entries(record.harnesses)) {
    const trimmed = harnessID.trim()
    if (!trimmed) continue
    const normalized = normalizeGroup(group)
    if (normalized.providers.length > 0 || normalized.models.length > 0) {
      harnesses[trimmed] = normalized
    }
  }
  return { version: 2, harnesses }
}

export function normalizeHiddenModels(value: unknown): HiddenModelsState {
  return normalizeState(value)
}

export function parseHiddenModels(raw: string | null): HiddenModelsState {
  if (!raw) return { version: 2, harnesses: {} }
  try {
    return normalizeState(JSON.parse(raw))
  } catch {
    return { version: 2, harnesses: {} }
  }
}

export function readHiddenModels(): HiddenModelsState {
  if (cached) return cached

  try {
    cached = parseHiddenModels(window.localStorage.getItem(HIDDEN_MODELS_KEY))
  } catch {
    cached = { version: 2, harnesses: {} }
  }

  return cached
}

export function isEmptyHiddenModels(state: HiddenModelsState): boolean {
  return Object.keys(state.harnesses).length === 0
}

/**
 * Visibility is one value per harness. Callers that change a provider or model
 * save the complete state so sync pushes the whole group at once.
 */
export function saveHiddenModels(value: unknown): void {
  cached = normalizeState(value)

  try {
    if (isEmptyHiddenModels(cached)) {
      window.localStorage.removeItem(HIDDEN_MODELS_KEY)
    } else {
      window.localStorage.setItem(HIDDEN_MODELS_KEY, JSON.stringify(cached))
    }
  } catch {
    // Storage can be unavailable in private browsing; keep the in-memory value.
  }

  notifySettingChanged(HIDDEN_MODELS_KEY)
  for (const listener of listeners) listener()
}

export function subscribeHiddenModels(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== HIDDEN_MODELS_KEY) return
    cached = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function hiddenModelsFor(
  state: HiddenModelsState,
  harnessID: string | undefined
): HiddenModels {
  if (!harnessID) return EMPTY_HIDDEN_MODELS
  return state.harnesses[harnessID] ?? EMPTY_HIDDEN_MODELS
}

function modelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/** Provider names can inherit the host name; show the product name. */
export function providerDisplayName(providerID: string, name?: string): string {
  if (providerID === 'opencode') return 'OpenCode'
  const trimmed = name?.trim()
  return trimmed || providerID
}

export function isProviderHidden(visibility: HiddenModels, providerID: string): boolean {
  return visibility.providers.includes(providerID)
}

export function isModelHidden(
  visibility: HiddenModels,
  providerID: string,
  modelID: string
): boolean {
  if (isProviderHidden(visibility, providerID)) return true
  return visibility.models.includes(modelKey(providerID, modelID))
}

export function isModelVisible(
  model: Pick<ClaraModel, 'providerID' | 'modelID' | 'enabled'>,
  visibility: HiddenModels
): boolean {
  return model.enabled && !isModelHidden(visibility, model.providerID, model.modelID)
}

export function withProviderHidden(
  state: HiddenModelsState,
  harnessID: string,
  providerID: string,
  hidden: boolean
): HiddenModelsState {
  const current = hiddenModelsFor(state, harnessID)
  const providers = new Set(current.providers)
  if (hidden) providers.add(providerID)
  else providers.delete(providerID)
  return withHarnessGroup(state, harnessID, {
    providers: [...providers],
    models: [...current.models],
  })
}

export function withModelHidden(
  state: HiddenModelsState,
  harnessID: string,
  providerID: string,
  modelID: string,
  hidden: boolean
): HiddenModelsState {
  const current = hiddenModelsFor(state, harnessID)
  const models = new Set(current.models)
  const key = modelKey(providerID, modelID)
  if (hidden) models.add(key)
  else models.delete(key)
  return withHarnessGroup(state, harnessID, {
    providers: [...current.providers],
    models: [...models],
  })
}

export function enableAllModels(state: HiddenModelsState, harnessID: string): HiddenModelsState {
  const harnesses = { ...state.harnesses }
  delete harnesses[harnessID]
  return { version: 2, harnesses }
}

export function disableAllModels(
  state: HiddenModelsState,
  harnessID: string,
  providerIDs: readonly string[]
): HiddenModelsState {
  const current = hiddenModelsFor(state, harnessID)
  return withHarnessGroup(state, harnessID, {
    providers: [...new Set([...current.providers, ...providerIDs])],
    models: [...current.models],
  })
}

function withHarnessGroup(
  state: HiddenModelsState,
  harnessID: string,
  group: HiddenModels
): HiddenModelsState {
  const harnesses = { ...state.harnesses }
  if (group.providers.length === 0 && group.models.length === 0) {
    delete harnesses[harnessID]
  } else {
    harnesses[harnessID] = group
  }
  return { version: 2, harnesses }
}

export function resolveInheritedModel<T extends { id: string; providerID: string }>(
  model: T | undefined,
  visibility: HiddenModels
): T | undefined {
  if (!model) return undefined
  return isModelHidden(visibility, model.providerID, model.id) ? undefined : model
}

/** A model is free when every cost tier is zero, including cache prices. */
export function isFreeModel(model: Pick<ClaraModel, 'cost'>): boolean {
  const costs = model.cost ?? []
  if (costs.length === 0) return true
  return costs.every(
    (cost) =>
      cost.input === 0 &&
      cost.output === 0 &&
      (cost.cache?.read ?? 0) === 0 &&
      (cost.cache?.write ?? 0) === 0
  )
}

export function filterModelsByPrice<T extends Pick<ClaraModel, 'cost'>>(
  models: T[],
  filter: PriceFilter
): T[] {
  if (filter === 'all') return models
  if (filter === 'free') return models.filter(isFreeModel)
  return models.filter((model) => !isFreeModel(model))
}

export function formatPricePerMillion(value: number | undefined): string {
  if (!value) return '$0'
  if (value < 0.01) return `$${value.toFixed(4).replace(/0+$/, '')}`
  if (value < 1) return `$${value.toFixed(3).replace(/0+$/, '')}`
  return `$${value.toFixed(2).replace(/\.?0+$/, '')}`
}
