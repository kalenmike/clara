/** The allowlisted theme tokens and the value grammar for each one. */

/** The CSS custom properties a theme may set. Keep in sync with `tokens.css`. */
export const THEME_TOKEN_NAMES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'status-success',
  'status-warning',
  'status-info',
  'status-danger',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const

export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]
export type ThemeTokenMap = Partial<Record<ThemeTokenName, string>>

export const REQUIRED_THEME_TOKENS = [
  'background',
  'foreground',
  'primary',
  'primary-foreground',
] as const

export const MAX_THEME_VALUE_LENGTH = 120

const TOKEN_SET: ReadonlySet<string> = new Set(THEME_TOKEN_NAMES)
// eslint-disable-next-line no-control-regex -- control characters are rejected deliberately.
const FORBIDDEN_VALUE_CHARACTERS = /[\u0000-\u001f\u007f;{}<>"'\\@!]/
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOR_FUNCTION =
  /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\([^;{}<>"'\\]*\)$/i
const VAR_REFERENCE = /^var\(--([a-z0-9-]+)\)$/
const FORBIDDEN_FUNCTION = /(?:url|var|attr|env|expression|javascript)\s*\(/i

/**
 * A value is either a colour or a `var(--token)` alias to another allowlisted
 * token. Nothing else is accepted, so the value can be assigned with
 * `style.setProperty` without any CSS parsing.
 */
export function validateTokenValue(
  name: string,
  value: unknown,
  checkBrowserSupport = false
): string | null {
  if (typeof value !== 'string') return 'must be a colour string'

  const trimmed = value.trim()
  if (trimmed.length === 0) return 'must not be empty'
  if (trimmed.length > MAX_THEME_VALUE_LENGTH) {
    return `must be at most ${MAX_THEME_VALUE_LENGTH} characters`
  }
  if (FORBIDDEN_VALUE_CHARACTERS.test(trimmed)) {
    return 'contains characters that are not allowed in a colour'
  }

  const reference = VAR_REFERENCE.exec(trimmed)
  if (reference) {
    if (reference[1] === name) return 'must not reference itself'
    if (!TOKEN_SET.has(reference[1]!)) {
      return `references the unknown token "--${reference[1]}"`
    }
    return null
  }

  if (FORBIDDEN_FUNCTION.test(trimmed)) {
    return 'must be a colour, not a function reference'
  }
  if (!HEX_COLOR.test(trimmed) && !COLOR_FUNCTION.test(trimmed)) {
    return 'must be a hex colour or a CSS colour function'
  }

  if (
    checkBrowserSupport &&
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    !CSS.supports('color', trimmed)
  ) {
    return 'is not supported as a colour by this browser'
  }
  return null
}

export function findVarCycle(tokens: ThemeTokenMap): string | null {
  const state = new Map<string, 'visiting' | 'done'>()

  function visit(name: string): string | null {
    const current = state.get(name)
    if (current === 'done') return null
    if (current === 'visiting') return name
    state.set(name, 'visiting')

    const value = tokens[name as ThemeTokenName]
    const reference = value ? VAR_REFERENCE.exec(value) : null
    if (reference?.[1] && TOKEN_SET.has(reference[1])) {
      const cycle = visit(reference[1])
      if (cycle) return cycle
    }

    state.set(name, 'done')
    return null
  }

  for (const name of Object.keys(tokens)) {
    const cycle = visit(name)
    if (cycle) return cycle
  }
  return null
}
