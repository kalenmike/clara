import {
  HarnessValidationError,
  type HarnessAuthType,
  type HarnessCandidate,
  type HarnessKind,
} from './types.ts'

const MAX_LABEL = 80
const MAX_USERNAME = 128
const MAX_PASSWORD = 1024

export type ValidateOptions = {
  /** True when an edit keeps the secret already stored for this connection. */
  hasSecret?: boolean
}

export function validateHarnessInput(
  value: unknown,
  options: ValidateOptions = {}
): HarnessCandidate {
  if (!isRecord(value)) throw new HarnessValidationError('invalid_body', 'Use a JSON object')

  const kind = readKind(value.kind)
  const label = readString(value.label, 'label', MAX_LABEL)
  const baseUrl = normalizeBaseUrl(readString(value.baseUrl, 'baseUrl', 2048))
  const authType = readAuthType(value.authType)

  let username: string | undefined
  let password: string | undefined
  if (authType === 'basic') {
    username = readOptionalString(value.username, 'username', MAX_USERNAME) ?? 'opencode'
    password = readPassword(value.password)
    if (!password && !options.hasSecret) {
      throw new HarnessValidationError('missing_password', 'A basic-auth harness needs a password')
    }
  }

  const rawOptions = value.options
  if (rawOptions !== undefined && !isRecord(rawOptions)) {
    throw new HarnessValidationError('invalid_options', 'Harness options must be a JSON object')
  }

  return {
    kind,
    label,
    baseUrl,
    authType,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(isRecord(rawOptions) ? { options: rawOptions } : {}),
  }
}

export function normalizeBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new HarnessValidationError('invalid_url', 'The harness URL is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HarnessValidationError('invalid_url', 'The harness URL must use http or https')
  }
  if (url.username || url.password) {
    throw new HarnessValidationError(
      'invalid_url',
      'Put credentials in the auth fields, not in the URL'
    )
  }
  if (url.search || url.hash) {
    throw new HarnessValidationError(
      'invalid_url',
      'The harness URL must not include a query or hash'
    )
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  url.pathname = pathname
  return url.toString().replace(/\/$/, '')
}

function readKind(value: unknown): HarnessKind {
  if (value !== 'opencode') {
    throw new HarnessValidationError('unsupported_kind', 'Only OpenCode harnesses are supported')
  }
  return value
}

function readAuthType(value: unknown): HarnessAuthType {
  if (value !== 'none' && value !== 'basic') {
    throw new HarnessValidationError('invalid_auth', 'Use authType "none" or "basic"')
  }
  return value
}

function readString(value: unknown, field: string, max: number): string {
  const text = readOptionalString(value, field, max)
  if (!text) throw new HarnessValidationError('invalid_body', `${field} is required`)
  return text
}

function readPassword(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new HarnessValidationError('invalid_body', 'password must be a string')
  }
  if (value.length > MAX_PASSWORD) {
    throw new HarnessValidationError('invalid_body', 'password is too long')
  }
  return value.length > 0 ? value : undefined
}

function readOptionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new HarnessValidationError('invalid_body', `${field} must be a string`)
  }
  const text = value.trim()
  if (!text) return undefined
  if (text.length > max) {
    throw new HarnessValidationError('invalid_body', `${field} is too long`)
  }
  return text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
