import { ADAPTER_KINDS, isAdapterKind, type AdapterKind } from '../adapters/registry.ts'

export type ParsedAdapterArgs = {
  values: string[]
  flags: Set<string>
  options: Map<string, string>
}

const FLAGS = new Set(['--no-start', '--json', '--purge', '--force', '--install'])
const OPTIONS = new Set(['--pair', '--transport', '--harness', '--version'])

export type KindSpec = {
  kind: AdapterKind
  version?: string
}

export function parseAdapterArgs(args: readonly string[]): ParsedAdapterArgs {
  const values: string[] = []
  const flags = new Set<string>()
  const options = new Map<string, string>()

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('-')) {
      values.push(arg)
      continue
    }
    const separator = arg.indexOf('=')
    const name = separator >= 0 ? arg.slice(0, separator) : arg
    if (OPTIONS.has(name)) {
      const value = separator >= 0 ? arg.slice(separator + 1) : args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
      options.set(name, value)
      continue
    }
    if (FLAGS.has(name) && separator < 0) {
      flags.add(name)
      continue
    }
    throw new Error(`unknown option: ${arg}`)
  }

  return { values, flags, options }
}

/** Parse `kind` or `kind@version`. */
export function parseKindSpec(value: string): KindSpec {
  const [kind, version, ...rest] = value.split('@')
  if (!kind || rest.length > 0 || version === '') {
    throw new Error(`invalid adapter target: ${value} (expected <kind>[@<version>])`)
  }
  if (!isAdapterKind(kind)) {
    throw new Error(`unknown adapter: ${kind} (expected ${ADAPTER_KINDS.join(', ')})`)
  }
  return { kind, ...(version ? { version } : {}) }
}

export function requireKind(
  value: string | undefined,
  command: string,
  prefix = 'clara adapter'
): KindSpec {
  if (!value) {
    throw new Error(`usage: ${prefix} ${command} <${ADAPTER_KINDS.join('|')}>`)
  }
  return parseKindSpec(value)
}

export function parseTransport(value: string | undefined): 'local' | 'relay' {
  if (value === undefined) return 'local'
  if (value === 'local' || value === 'relay') return value
  throw new Error(`--transport must be local or relay, not ${value}`)
}
