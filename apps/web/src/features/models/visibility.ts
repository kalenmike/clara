import type { ModelInfo } from '@opencode/client'
import { notifySettingChanged } from '@/lib/setting-events'

export const HIDDEN_MODELS_KEY = 'clara.hiddenModels'

export type HiddenModels = {
  providers: string[]
  models: string[]
}

export type PriceFilter = 'all' | 'free' | 'paid'

const MAX_ENTRIES = 5_000

let cached: HiddenModels | null = null
const listeners = new Set<() => void>()

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

export function normalizeHiddenModels(value: unknown): HiddenModels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { providers: [], models: [] }
  }
  const record = value as Record<string, unknown>
  return {
    providers: normalizeList(record.providers),
    models: normalizeList(record.models),
  }
}

export function parseHiddenModels(raw: string | null): HiddenModels {
  if (!raw) return { providers: [], models: [] }
  try {
    return normalizeHiddenModels(JSON.parse(raw))
  } catch {
    return { providers: [], models: [] }
  }
}

export function readHiddenModels(): HiddenModels {
  if (cached) return cached

  try {
    cached = parseHiddenModels(window.localStorage.getItem(HIDDEN_MODELS_KEY))
  } catch {
    cached = { providers: [], models: [] }
  }

  return cached
}

/**
 * Visibility is one value: callers that change a provider or model should save
 * the complete snapshot so sync pushes the whole group at once.
 */
export function saveHiddenModels(value: unknown): void {
  cached = normalizeHiddenModels(value)

  try {
    if (cached.providers.length === 0 && cached.models.length === 0) {
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

function modelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/** OpenCode's provider name can inherit the host name; show the product name. */
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
  model: Pick<ModelInfo, 'providerID' | 'modelID' | 'enabled'>,
  visibility: HiddenModels
): boolean {
  return model.enabled && !isModelHidden(visibility, model.providerID, model.modelID)
}

export function withProviderHidden(
  visibility: HiddenModels,
  providerID: string,
  hidden: boolean
): HiddenModels {
  const providers = new Set(visibility.providers)
  if (hidden) providers.add(providerID)
  else providers.delete(providerID)
  return { providers: [...providers], models: [...visibility.models] }
}

export function withModelHidden(
  visibility: HiddenModels,
  providerID: string,
  modelID: string,
  hidden: boolean
): HiddenModels {
  const models = new Set(visibility.models)
  const key = modelKey(providerID, modelID)
  if (hidden) models.add(key)
  else models.delete(key)
  return { providers: [...visibility.providers], models: [...models] }
}

export function enableAllModels(): HiddenModels {
  return { providers: [], models: [] }
}

export function resolveInheritedModel<T extends { id: string; providerID: string }>(
  model: T | undefined,
  visibility: HiddenModels
): T | undefined {
  if (!model) return undefined
  return isModelHidden(visibility, model.providerID, model.id) ? undefined : model
}

/** A model is free when every cost tier is zero, including cache prices. */
export function isFreeModel(model: Pick<ModelInfo, 'cost'>): boolean {
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

export function filterModelsByPrice<T extends Pick<ModelInfo, 'cost'>>(
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
