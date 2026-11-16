export type Flags = {
  flags: Set<string>
  options: Map<string, string>
  positionals: string[]
}

const WITH_VALUE = new Set([
  'username',
  'password',
  'base-url',
  'bin-dir',
  'file',
  'sha256',
  'version',
  'channel',
  'target',
  'tail',
])

export function parseFlags(args: readonly string[]): Flags {
  const flags = new Set<string>()
  const options = new Map<string, string>()
  const positionals: string[] = []

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const [name, inline] = arg.slice(2).split('=', 2)
    if (inline !== undefined) {
      options.set(name, inline)
      continue
    }
    if (WITH_VALUE.has(name)) {
      const value = args[++index]
      if (!value) throw new Error(`--${name} needs a value`)
      options.set(name, value)
      continue
    }
    flags.add(name)
  }

  return { flags, options, positionals }
}
