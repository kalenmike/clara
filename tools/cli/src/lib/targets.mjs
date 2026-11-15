// Command targets for the Clara CLI.
//
// A lifecycle command accepts one target before its options:
//
//   clara start hub --local
//   clara status adapter --json
//
// Targets are intentionally a fixed list. Unknown words are rejected instead of
// being forwarded, so a typo cannot silently become a service name.

export const LIFECYCLE_TARGETS = [
  'default',
  'hub',
  'web',
  'engine',
  'orchestrator',
  'adapter',
  'runner',
  'lab',
  'docs',
]

export const CORE_TARGETS = ['hub', 'web', 'orchestrator']

export const BACKUP_TARGETS = ['default', 'hub', 'engine', 'orchestrator']

export const PAIR_TARGETS = ['default', 'hub', 'adapter']

/**
 * `engine` is the public name. The rebuild snapshot and the internal service
 * map still use `orchestrator` for one release, so the alias resolves here.
 */
const TARGET_ALIASES = { engine: 'orchestrator' }

export function normalizeTarget(target) {
  return TARGET_ALIASES[target] ?? target
}

/** Target names that map to the internal `server` service key. */
export function serviceKey(target) {
  return target === 'hub' ? 'server' : target
}

export function isLifecycleTarget(value) {
  return LIFECYCLE_TARGETS.includes(value)
}

/**
 * Remove the first target word from an argument list. `fallback` is returned
 * when the first non-option token is not a known target. Callers that accept a
 * positional argument (restore archives) pass a different allowed list.
 */
export function takeTarget(args, allowed = LIFECYCLE_TARGETS, fallback = 'default') {
  const rest = [...args]
  const index = rest.findIndex((arg) => !arg.startsWith('-'))
  if (index < 0) return { target: fallback, args: rest }
  const value = rest[index]
  if (!allowed.includes(value)) return { target: fallback, args: rest }
  rest.splice(index, 1)
  return { target: value, args: rest }
}

/** Split an option list into `--flag`, `--flag=value`, and positionals. */
export function splitArgs(args) {
  const flags = []
  const positionals = []
  for (const arg of args) {
    if (arg.startsWith('-')) flags.push(arg)
    else positionals.push(arg)
  }
  return { flags, positionals }
}

export function failUnknown(arg, usage) {
  const error = new Error(`unknown option: ${arg}`)
  error.usage = usage
  throw error
}
