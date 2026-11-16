/**
 * The theme document schema.
 *
 * A theme is data, never CSS. Every value below is either a colour or a
 * reference to another allowlisted token, so the web client can apply a theme
 * with `style.setProperty` and never parse or inject a stylesheet.
 */

import {
  REQUIRED_THEME_TOKENS,
  THEME_TOKEN_NAMES,
  findVarCycle,
  validateTokenValue,
  type ThemeTokenMap,
  type ThemeTokenName,
} from './tokens.ts'

export { MAX_THEME_VALUE_LENGTH, REQUIRED_THEME_TOKENS, THEME_TOKEN_NAMES } from './tokens.ts'
export type { ThemeTokenMap, ThemeTokenName } from './tokens.ts'

export const THEME_SCHEMA_VERSION = 1
export const DEFAULT_THEME_ID = 'default'

export type ThemeVariant = 'light' | 'dark'

export type ThemeDefinition = {
  name: string
  light: ThemeTokenMap
  dark: ThemeTokenMap
}

export type StoredTheme = ThemeDefinition & { id: string }

export type ThemeCatalog = {
  version: typeof THEME_SCHEMA_VERSION
  themes: StoredTheme[]
}

export type ThemeParseError = {
  path: string
  message: string
}

export type ThemeParseResult<T> = { ok: true; value: T } | { ok: false; errors: ThemeParseError[] }

export type ThemeParseOptions = {
  /** Reject colors the current browser cannot parse. Imports use this. */
  checkBrowserSupport?: boolean
}

export const MAX_THEME_NAME_LENGTH = 48
export const MAX_CUSTOM_THEMES = 20
export const MAX_THEME_BYTES = 16 * 1024
export const MAX_THEME_IMPORT_BYTES = 64 * 1024
export const MAX_THEME_CATALOG_BYTES = 60 * 1024

const TOKEN_SET: ReadonlySet<string> = new Set(THEME_TOKEN_NAMES)
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/
const CUSTOM_THEME_ID_PATTERN = /^custom-[a-z0-9]{8}$/
// eslint-disable-next-line no-control-regex -- control characters are rejected deliberately.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex -- bidi and zero-width characters are rejected deliberately.
const DIRECTION_CHARACTERS = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/

const textEncoder = new TextEncoder()

export function byteLength(value: string): number {
  return textEncoder.encode(value).byteLength
}

/** A theme file pasted or uploaded by the user. */
export function parseThemeFile(
  input: unknown,
  options: ThemeParseOptions = {}
): ThemeParseResult<ThemeDefinition> {
  if (!isRecord(input)) return failure('theme', 'must be a JSON object')
  if (input.schemaVersion !== THEME_SCHEMA_VERSION) {
    return failure('schemaVersion', `must be ${THEME_SCHEMA_VERSION}`)
  }

  const definition = parseDefinition(input, 'theme', options.checkBrowserSupport ?? true)
  if (!definition.ok) return definition

  if (byteLength(JSON.stringify(definition.value)) > MAX_THEME_BYTES) {
    return failure('theme', `must be at most ${MAX_THEME_BYTES} bytes`)
  }
  return definition
}

/** The built-in catalog in `themes.json` and the optional custom catalog. */
export function parseBuiltInThemeCatalog(input: unknown): ThemeParseResult<ThemeCatalog> {
  return parseCatalog(input, false)
}

/** The custom theme catalog stored locally and synchronized through the hub. */
export function parseCustomThemeCatalog(input: unknown): ThemeParseResult<ThemeCatalog> {
  return parseCatalog(input, true)
}

export function createCustomThemeId(existingIds: Iterable<string> = []): string {
  const taken = new Set(existingIds)
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = `custom-${randomHex(4)}`
    if (!taken.has(id)) return id
  }
  throw new Error('Could not allocate a custom theme id')
}

export function createCustomTheme(
  definition: ThemeDefinition,
  existingIds: Iterable<string> = []
): StoredTheme {
  return { id: createCustomThemeId(existingIds), ...definition }
}

export function isBuiltInThemeId(value: unknown): value is string {
  return typeof value === 'string' && THEME_ID_PATTERN.test(value)
}

export function isCustomThemeId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_THEME_ID_PATTERN.test(value)
}

export function createThemeCatalog(themes: StoredTheme[]): ThemeCatalog {
  return { version: THEME_SCHEMA_VERSION, themes }
}

export function serializeThemeCatalog(themes: StoredTheme[]): string {
  return JSON.stringify(createThemeCatalog(themes))
}

export function themeCatalogBytes(themes: StoredTheme[]): number {
  return byteLength(serializeThemeCatalog(themes))
}

function parseCatalog(input: unknown, customOnly: boolean): ThemeParseResult<ThemeCatalog> {
  if (!isRecord(input)) return failure('catalog', 'must be a JSON object')
  if (input.version !== THEME_SCHEMA_VERSION) {
    return failure('version', `must be ${THEME_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(input.themes)) return failure('themes', 'must be an array')
  if (input.themes.length > MAX_CUSTOM_THEMES) {
    return failure('themes', `may hold at most ${MAX_CUSTOM_THEMES} themes`)
  }

  const errors: ThemeParseError[] = []
  const themes: StoredTheme[] = []
  const ids = new Set<string>()

  for (const [index, candidate] of input.themes.entries()) {
    const path = `themes[${index}]`
    if (!isRecord(candidate)) {
      errors.push({ path, message: 'must be an object' })
      continue
    }

    const id = candidate.id
    const validId =
      typeof id === 'string' &&
      (customOnly ? CUSTOM_THEME_ID_PATTERN.test(id) : THEME_ID_PATTERN.test(id))
    if (!validId) {
      errors.push({
        path: `${path}.id`,
        message: customOnly
          ? 'must be a generated custom theme id'
          : 'must be 1-32 lowercase letters, numbers, or dashes',
      })
      continue
    }
    if (ids.has(id)) {
      errors.push({ path: `${path}.id`, message: `duplicates "${id}"` })
      continue
    }
    ids.add(id)

    const definition = parseDefinition(candidate, path, false)
    if (!definition.ok) {
      errors.push(...definition.errors)
      continue
    }

    const theme: StoredTheme = { id, ...definition.value }
    if (byteLength(JSON.stringify(theme)) > MAX_THEME_BYTES) {
      errors.push({ path, message: `must be at most ${MAX_THEME_BYTES} bytes` })
      continue
    }
    themes.push(theme)
  }

  if (errors.length > 0) return { ok: false, errors }

  if (themeCatalogBytes(themes) > MAX_THEME_CATALOG_BYTES) {
    return failure('themes', `must be at most ${MAX_THEME_CATALOG_BYTES} bytes`)
  }

  return { ok: true, value: createThemeCatalog(themes) }
}

function parseDefinition(
  input: Record<string, unknown>,
  path: string,
  checkBrowserSupport: boolean
): ThemeParseResult<ThemeDefinition> {
  const errors: ThemeParseError[] = []
  const name = parseName(input.name, `${path}.name`, errors)
  const light = parseVariant(input.light, `${path}.light`, errors, checkBrowserSupport)
  const dark = parseVariant(input.dark, `${path}.dark`, errors, checkBrowserSupport)

  if (errors.length > 0 || name === null || light === null || dark === null) {
    return { ok: false, errors }
  }
  return { ok: true, value: { name, light, dark } }
}

function parseName(input: unknown, path: string, errors: ThemeParseError[]): string | null {
  if (typeof input !== 'string') {
    errors.push({ path, message: 'must be a string' })
    return null
  }
  const name = input.trim()
  if (name.length === 0) {
    errors.push({ path, message: 'must not be empty' })
    return null
  }
  if (name.length > MAX_THEME_NAME_LENGTH) {
    errors.push({ path, message: `must be at most ${MAX_THEME_NAME_LENGTH} characters` })
    return null
  }
  if (CONTROL_CHARACTERS.test(name) || DIRECTION_CHARACTERS.test(name)) {
    errors.push({ path, message: 'must not contain control or direction characters' })
    return null
  }
  return name
}

function parseVariant(
  input: unknown,
  path: string,
  errors: ThemeParseError[],
  checkBrowserSupport: boolean
): ThemeTokenMap | null {
  if (!isRecord(input)) {
    errors.push({ path, message: 'must be an object of theme tokens' })
    return null
  }

  const tokens: ThemeTokenMap = {}
  for (const [name, value] of Object.entries(input)) {
    if (!TOKEN_SET.has(name)) {
      errors.push({ path: `${path}.${name}`, message: 'is not a recognised theme token' })
      continue
    }
    const message = validateTokenValue(name, value, checkBrowserSupport)
    if (message) {
      errors.push({ path: `${path}.${name}`, message })
      continue
    }
    tokens[name as ThemeTokenName] = (value as string).trim()
  }

  for (const required of REQUIRED_THEME_TOKENS) {
    if (!tokens[required]) errors.push({ path: `${path}.${required}`, message: 'is required' })
  }

  const cycle = findVarCycle(tokens)
  if (cycle) {
    errors.push({ path, message: `"${cycle}" references itself through var()` })
  }

  return tokens
}

function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes)
  const crypto = globalThis.crypto
  if (typeof crypto?.getRandomValues === 'function') {
    crypto.getRandomValues(data)
  } else {
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function failure(path: string, message: string): ThemeParseResult<never> {
  return { ok: false, errors: [{ path, message }] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
