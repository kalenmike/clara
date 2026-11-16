import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILT_IN_THEMES, baseThemeTokens } from './catalog.ts'
import {
  DEFAULT_THEME_ID,
  MAX_CUSTOM_THEMES,
  MAX_THEME_CATALOG_BYTES,
  MAX_THEME_NAME_LENGTH,
  THEME_TOKEN_NAMES,
  byteLength,
  createCustomThemeId,
  parseBuiltInThemeCatalog,
  parseCustomThemeCatalog,
  parseThemeFile,
  serializeThemeCatalog,
  themeCatalogBytes,
  type StoredTheme,
  type ThemeDefinition,
  type ThemeTokenName,
} from './schema.ts'

const REQUIRED = {
  background: '#ffffff',
  foreground: '#111111',
  primary: '#0055ff',
  'primary-foreground': '#ffffff',
}

function themeFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: 'Test theme',
    light: { ...REQUIRED },
    dark: { ...REQUIRED },
    ...overrides,
  }
}

function storedTheme(id: string, definition: ThemeDefinition): StoredTheme {
  return { id, ...definition }
}

function longColor(index: number): string {
  return `rgb(0 0 0 / 0.${String(index).padStart(3, '0')}${'0'.repeat(100)})`
}

describe('parseThemeFile', () => {
  it('accepts a minimal theme and trims values', () => {
    const result = parseThemeFile(
      themeFile({
        name: '  Test theme  ',
        light: { ...REQUIRED, background: ' #ffffff ' },
      })
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.name).toBe('Test theme')
    expect(result.value.light.background).toBe('#ffffff')
    expect(result.value.dark).toEqual(REQUIRED)
  })

  it('accepts every supported colour form', () => {
    const values = [
      '#fff',
      '#ffffff80',
      'rgb(255 255 255)',
      'hsl(0 0% 100%)',
      'oklch(1 0 0 / 50%)',
      'color(display-p3 1 0 0)',
      'color-mix(in oklch, #ffffff 50%, #000000 50%)',
      'var(--destructive)',
    ]

    for (const value of values) {
      const result = parseThemeFile(themeFile({ light: { ...REQUIRED, accent: value } }))
      expect(result.ok, value).toBe(true)
    }
  })

  it('rejects css injection attempts', () => {
    const values = [
      'red; } body { display: none }',
      'url(https://example.com/x)',
      'var(--evil)',
      'expr\\65 ssion(alert(1))',
      'expression(alert(1))',
      'attr(data-colour)',
      '"red"',
      'red !important',
      '@import "x"',
      'rgb(0 0 0); background: url(x)',
    ]

    for (const value of values) {
      const result = parseThemeFile(themeFile({ dark: { ...REQUIRED, primary: value } }))
      expect(result.ok, value).toBe(false)
    }
  })

  it('rejects unknown tokens, missing tokens, and bad names', () => {
    expect(parseThemeFile(themeFile({ light: { ...REQUIRED, backgroundx: '#ffffff' } })).ok).toBe(
      false
    )
    expect(
      parseThemeFile(themeFile({ light: { background: '#ffffff', foreground: '#111111' } })).ok
    ).toBe(false)
    expect(parseThemeFile(themeFile({ name: 'x'.repeat(MAX_THEME_NAME_LENGTH + 1) })).ok).toBe(
      false
    )
    expect(parseThemeFile(themeFile({ name: '   ' })).ok).toBe(false)
    expect(parseThemeFile(themeFile({ name: 'bad\nname' })).ok).toBe(false)
    expect(parseThemeFile(themeFile({ name: 'bad\u202ename' })).ok).toBe(false)
    expect(parseThemeFile(themeFile({ schemaVersion: 2 })).ok).toBe(false)
    expect(parseThemeFile({ ...themeFile(), schemaVersion: undefined }).ok).toBe(false)
    expect(parseThemeFile(themeFile({ light: [] })).ok).toBe(false)
  })

  it('rejects self references and var cycles', () => {
    const self = parseThemeFile(themeFile({ light: { ...REQUIRED, accent: 'var(--accent)' } }))
    expect(self.ok).toBe(false)

    const cycle = parseThemeFile(
      themeFile({
        light: { ...REQUIRED, accent: 'var(--ring)', ring: 'var(--accent)' },
      })
    )
    expect(cycle.ok).toBe(false)
  })
})

describe('theme catalog', () => {
  it('requires generated ids for custom themes', () => {
    const theme = { id: 'nord', name: 'Nord', light: REQUIRED, dark: REQUIRED }
    const catalog = { version: 1, themes: [theme] }

    expect(parseCustomThemeCatalog(catalog).ok).toBe(false)
    expect(
      parseCustomThemeCatalog({ ...catalog, themes: [{ ...theme, id: 'custom-1234abcd' }] }).ok
    ).toBe(true)
  })

  it('rejects duplicate ids and too many themes', () => {
    const theme = { id: 'custom-1234abcd', name: 'One', light: REQUIRED, dark: REQUIRED }
    expect(parseCustomThemeCatalog({ version: 1, themes: [theme, theme] }).ok).toBe(false)

    const many = Array.from({ length: MAX_CUSTOM_THEMES + 1 }, (_, index) => ({
      ...theme,
      id: `custom-${index.toString(16).padStart(8, '0')}`,
    }))
    expect(parseCustomThemeCatalog({ version: 1, themes: many }).ok).toBe(false)
  })

  it('rejects a catalog over the synchronized size limit', () => {
    const themes: StoredTheme[] = Array.from({ length: 7 }, (_, index) => {
      const light = {} as Record<ThemeTokenName, string>
      const dark = {} as Record<ThemeTokenName, string>
      for (const [tokenIndex, name] of THEME_TOKEN_NAMES.entries()) {
        light[name] = longColor(index * 100 + tokenIndex)
        dark[name] = longColor(index * 100 + tokenIndex)
      }
      return storedTheme(`custom-${(index + 1).toString(16).padStart(8, '0')}`, {
        name: `Theme ${index}`,
        light,
        dark,
      })
    })

    expect(themeCatalogBytes(themes)).toBeGreaterThan(MAX_THEME_CATALOG_BYTES)
    expect(parseCustomThemeCatalog(JSON.parse(serializeThemeCatalog(themes))).ok).toBe(false)
  })

  it('allocates non-colliding custom ids', () => {
    const existing = new Set<string>()
    for (let index = 0; index < 20; index += 1) {
      const id = createCustomThemeId(existing)
      expect(existing.has(id)).toBe(false)
      existing.add(id)
    }
  })
})

describe('built-in catalog', () => {
  it('parses the shipped palettes', () => {
    expect(BUILT_IN_THEMES.length).toBe(8)
    expect(BUILT_IN_THEMES[0]?.id).toBe(DEFAULT_THEME_ID)
  })

  it('keeps every palette complete', () => {
    for (const theme of BUILT_IN_THEMES) {
      for (const variant of ['light', 'dark'] as const) {
        expect(Object.keys(theme[variant]).sort(), `${theme.id} ${variant}`).toEqual(
          [...THEME_TOKEN_NAMES].sort()
        )
      }
    }
  })

  it('matches the hardcoded Default palette in tokens.css', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
    const light = readCssBlock(css, ':root')
    const dark = readCssBlock(css, '\\.dark')

    expect(baseThemeTokens('light')).toEqual(light)
    expect(baseThemeTokens('dark')).toEqual(dark)
  })

  it('rejects a catalog with any invalid entry', () => {
    const catalog = JSON.parse(readFileSync(new URL('./themes.json', import.meta.url), 'utf8')) as {
      themes: Array<Record<string, unknown>>
    }
    catalog.themes[1] = { ...catalog.themes[1], light: { background: 'url(x)' } }
    expect(parseBuiltInThemeCatalog(catalog).ok).toBe(false)
  })
})

function readCssBlock(css: string, selector: string): Record<string, string> {
  const match = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)
  if (!match) throw new Error(`Missing ${selector} block in tokens.css`)

  const tokens: Record<string, string> = {}
  for (const line of match[1]!.split('\n')) {
    const declaration = /^\s*--([a-z0-9-]+):\s*(.+);\s*$/.exec(line)
    if (!declaration) continue
    const [, name, value] = declaration
    if (!name || value === undefined) continue
    if (!(THEME_TOKEN_NAMES as readonly string[]).includes(name)) continue
    tokens[name] = value.trim()
  }
  return tokens
}

it('measures utf-8 bytes', () => {
  expect(byteLength('clara')).toBe(5)
  expect(byteLength('✓')).toBe(3)
})
