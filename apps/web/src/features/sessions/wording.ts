import { notifySettingChanged } from '@/lib/setting-events'

export const SESSION_WORDING_KEY = 'clara.sessionWording'
export const DEFAULT_SESSION_WORD = 'Brief'
export const MAX_SESSION_WORD_LENGTH = 24

export type SessionWording = {
  singular: string
  plural: string
  lowerSingular: string
  lowerPlural: string
}

let cached: SessionWording | null = null
const listeners = new Set<() => void>()

function pluralize(word: string): string {
  const lower = word.toLowerCase()
  if (/(s|x|z|ch|sh)$/.test(lower)) return `${word}es`
  if (/[^aeiou]y$/.test(lower)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

function normalize(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SESSION_WORD

  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, MAX_SESSION_WORD_LENGTH).trimEnd()
  if (!trimmed) return DEFAULT_SESSION_WORD

  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

function build(singular: string): SessionWording {
  const plural = pluralize(singular)
  return {
    singular,
    plural,
    lowerSingular: singular.toLowerCase(),
    lowerPlural: plural.toLowerCase(),
  }
}

export function readSessionWording(): SessionWording {
  if (!cached) {
    cached = build(normalize(window.localStorage.getItem(SESSION_WORDING_KEY)))
  }
  return cached
}

export function saveSessionWording(value: string): string {
  cached = build(normalize(value))
  window.localStorage.setItem(SESSION_WORDING_KEY, cached.singular)
  for (const listener of listeners) listener()
  notifySettingChanged(SESSION_WORDING_KEY)
  return cached.singular
}

export function resetSessionWording(): string {
  return saveSessionWording(DEFAULT_SESSION_WORD)
}

export function subscribeSessionWording(listener: () => void): () => void {
  listeners.add(listener)

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_WORDING_KEY) return
    cached = null
    listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}
