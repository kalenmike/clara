import themesJson from './themes.json'
import {
  DEFAULT_THEME_ID,
  parseBuiltInThemeCatalog,
  type StoredTheme,
  type ThemeTokenName,
  type ThemeTokenMap,
  type ThemeVariant,
} from './schema.ts'

const parsed = parseBuiltInThemeCatalog(themesJson)
if (!parsed.ok) {
  const details = parsed.errors.map((error) => `${error.path} ${error.message}`).join('; ')
  throw new Error(`Invalid built-in theme catalog: ${details}`)
}

/**
 * Default first, followed by the named palettes in the order the settings card
 * lists them.
 */
export const BUILT_IN_THEMES: readonly StoredTheme[] = parsed.value.themes

const BASE_THEME = BUILT_IN_THEMES.find((theme) => theme.id === DEFAULT_THEME_ID)
if (!BASE_THEME) throw new Error('The built-in theme catalog is missing the default palette')

const BUILT_IN_BY_ID = new Map(BUILT_IN_THEMES.map((theme) => [theme.id, theme]))

export function builtInTheme(id: string): StoredTheme | undefined {
  return BUILT_IN_BY_ID.get(id)
}

/**
 * The hardcoded palette in `tokens.css`, mirrored as data for import previews.
 * The stylesheet stays the source of truth for the app before JavaScript runs.
 */
export function baseThemeTokens(variant: ThemeVariant): ThemeTokenMap {
  return BASE_THEME![variant]
}

export function baseThemeToken(name: ThemeTokenName, variant: ThemeVariant): string | undefined {
  return BASE_THEME![variant][name]
}
