import { base64UrlToBytes } from '@clara/crypto'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import type { ShellPolicy } from '@clara/shared-types'
import type { HttpRequestAction } from './opencode.ts'

export const DEFAULT_SHELL_POLICY: ShellPolicy = { mode: 'off', commands: [] }
export const MAX_SHELL_COMMANDS = 32
export const MAX_SHELL_COMMAND_LENGTH = 200

/**
 * A command string is handed to a shell, so a filter entry that matched shell
 * syntax would be trivial to escape. These characters never appear in a
 * filtered request, which keeps entries literal.
 */
const METACHARACTERS = [
  '\n',
  '\r',
  ';',
  '&',
  '|',
  '<',
  '>',
  '`',
  '$',
  '\\',
  '"',
  "'",
  '#',
  '*',
  '?',
  '[',
  ']',
  '(',
  ')',
  '{',
  '}',
  '~',
  '!',
]

/**
 * Allowing an interpreter in a filter turns it into "run anything". Entries
 * that name one are rejected instead of being silently accepted.
 */
const INTERPRETERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'csh',
  'tcsh',
  'env',
  'xargs',
  'nohup',
  'python',
  'python3',
  'node',
  'ruby',
  'perl',
  'php',
  'awk',
  'sed',
  'osascript',
  'powershell',
  'pwsh',
  'cmd',
])

type CommandRoute = {
  method: 'POST'
  matches: (path: string) => boolean
}

const COMMAND_ROUTES: CommandRoute[] = [
  { method: 'POST', matches: (path) => path === '/api/shell' },
  { method: 'POST', matches: (path) => path === '/api/pty' },
  { method: 'POST', matches: (path) => path === '/api/experimental/persistent-pty' },
  { method: 'POST', matches: (path) => /^\/api\/session\/[^/]+\/shell$/.test(path) },
  {
    method: 'POST',
    matches: (path) => /^\/api\/experimental\/session\/[^/]+\/terminal$/.test(path),
  },
]

export type ShellDenyCode = 'shell_disabled' | 'shell_denied' | 'shell_invalid' | 'shell_location'

export type ShellDecision =
  { allowed: true } | { allowed: false; status: 400 | 403; code: ShellDenyCode; message: string }

export type ShellPolicyParse = { ok: true; policy: ShellPolicy } | { ok: false; message: string }

/**
 * Gate one proxied request. Non-command requests always pass. The policy is
 * read on every call, so a panel change applies to the next request without a
 * restart.
 */
export function evaluateShellRequest(
  policy: ShellPolicy,
  action: HttpRequestAction
): ShellDecision {
  const isShellRead = action.path === '/api/shell' || action.path.startsWith('/api/shell/')
  const isCommand = COMMAND_ROUTES.some(
    (route) => route.method === action.method && route.matches(action.path)
  )

  if (!isCommand) {
    if (policy.mode === 'off' && isShellRead) {
      return deny('shell_disabled', 'Shell commands are disabled by the Clara server policy')
    }
    return { allowed: true }
  }

  if (policy.mode === 'off') {
    return deny('shell_disabled', 'Shell commands are disabled by the Clara server policy')
  }

  const location = readLocationDirectory(action.search)
  if (!location) {
    return {
      allowed: false,
      status: 400,
      code: 'shell_location',
      message: 'A command request must name a location directory',
    }
  }

  const parsed = readCommand(action)
  if (!parsed.ok) return parsed.decision

  if (parsed.cwd && !isWithin(location, parsed.cwd)) {
    return {
      allowed: false,
      status: 403,
      code: 'shell_denied',
      message: 'The command working directory is outside the request location',
    }
  }

  // An empty filter list is an explicit "allow every command" policy. The
  // location and working-directory checks above still apply, but there is
  // nothing left to match the command against.
  if (policy.commands.length === 0) return { allowed: true }

  if (parsed.tokens.some((token) => containsMetacharacter(token))) {
    return metacharacterDenial()
  }

  // A newline is whitespace, so tokenizing alone would hide it. Check the raw
  // string before anything else is allowed.
  if (containsMetacharacter(parsed.raw)) {
    return metacharacterDenial()
  }

  const allowed = policy.commands.some((entry) => isPrefix(entry, parsed.tokens))
  if (!allowed) {
    return deny('shell_denied', 'The command does not match any Clara shell filter')
  }

  return { allowed: true }
}

/**
 * Validate a policy coming from the panel. `off` keeps the saved filter list so
 * switching back to `allowlist` does not lose it. An empty list in `allowlist`
 * mode allows every command.
 */
export function parseShellPolicy(mode: unknown, commands: unknown): ShellPolicyParse {
  if (mode !== 'off' && mode !== 'allowlist') {
    return { ok: false, message: 'mode must be "off" or "allowlist"' }
  }
  if (!Array.isArray(commands)) {
    return { ok: false, message: 'commands must be an array of strings' }
  }
  if (commands.length > MAX_SHELL_COMMANDS) {
    return { ok: false, message: `commands must contain at most ${MAX_SHELL_COMMANDS} entries` }
  }

  const normalized: string[] = []
  for (const value of commands) {
    const parsed = normalizeCommandEntry(value)
    if (!parsed.ok) return parsed
    if (!normalized.includes(parsed.command)) normalized.push(parsed.command)
  }

  return { ok: true, policy: { mode, commands: normalized } }
}

/** Read a policy that was already validated when it was written. */
export function readStoredShellPolicy(mode: unknown, commands: unknown): ShellPolicy {
  const parsed = parseShellPolicy(mode, commands)
  if (!parsed.ok) {
    throw new Error(`The stored shell policy is invalid: ${parsed.message}`)
  }
  return parsed.policy
}

function metacharacterDenial(): ShellDecision {
  return deny(
    'shell_denied',
    'The command contains shell syntax; only literal arguments are allowed'
  )
}

function deny(code: ShellDenyCode, message: string): ShellDecision {
  return { allowed: false, status: 403, code, message }
}

function normalizeCommandEntry(
  value: unknown
): { ok: true; command: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Each command must be a string' }

  const command = value.trim().replace(/\s+/g, ' ')
  if (!command) return { ok: false, message: 'Commands cannot be empty' }
  if (command.length > MAX_SHELL_COMMAND_LENGTH) {
    return {
      ok: false,
      message: `Commands must be ${MAX_SHELL_COMMAND_LENGTH} characters or fewer`,
    }
  }
  if (containsMetacharacter(command)) {
    return { ok: false, message: `Commands cannot contain shell syntax: ${command}` }
  }

  const [binary] = command.split(' ')
  if (isInterpreter(binary)) {
    return {
      ok: false,
      message: `Allowlisting the interpreter "${binary}" would allow any command`,
    }
  }

  return { ok: true, command }
}

function containsMetacharacter(value: string): boolean {
  return METACHARACTERS.some((character) => value.includes(character))
}

function isInterpreter(binary: string): boolean {
  return INTERPRETERS.has(basename(binary).toLowerCase())
}

function isPrefix(entry: string, tokens: string[]): boolean {
  const entryTokens = entry.split(' ')
  if (entryTokens.length === 0 || entryTokens.length > tokens.length) return false
  return entryTokens.every((token, index) => token === tokens[index])
}

function readCommand(
  action: HttpRequestAction
):
  | { ok: true; raw: string; tokens: string[]; cwd?: string }
  | { ok: false; decision: ShellDecision } {
  let body: unknown
  try {
    body = action.body
      ? JSON.parse(new TextDecoder().decode(base64UrlToBytes(action.body)))
      : undefined
  } catch {
    return invalid('The command request body is not valid JSON')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('The command request body must be a JSON object')
  }

  const record = body as Record<string, unknown>
  const command = record.command
  if (typeof command !== 'string' || command.trim() === '') {
    return invalid('The command request does not name a command')
  }

  const args = Array.isArray(record.args)
    ? record.args.filter((value): value is string => typeof value === 'string')
    : []

  const tokens = tokenize(command)
  const binary = tokens[0]
  if (!binary) return invalid('The command request does not name a command')

  // PTY requests pass the binary and its arguments separately, so both belong
  // to the prefix a filter entry has to cover.
  const allTokens = args.length > 0 && tokens.length === 1 ? [binary, ...args] : tokens

  const cwd = typeof record.cwd === 'string' && record.cwd.trim() ? record.cwd.trim() : undefined
  return { ok: true, raw: command, tokens: allTokens, ...(cwd ? { cwd } : {}) }
}

function invalid(message: string): { ok: false; decision: ShellDecision } {
  return { ok: false, decision: { allowed: false, status: 400, code: 'shell_invalid', message } }
}

function tokenize(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function readLocationDirectory(search: string | undefined): string | undefined {
  if (!search) return undefined
  const params = new URLSearchParams(search)
  const directory = params.get('location[directory]')
  return directory && directory.trim() ? directory : undefined
}

function isWithin(base: string, candidate: string): boolean {
  const basePath = resolve(base)
  const candidatePath = resolve(candidate)
  const rel = relative(basePath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
