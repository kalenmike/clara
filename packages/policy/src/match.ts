/** Convert a small glob (`*`, `**`, `?`) to a regular expression. */
export function globToRegExp(glob: string): RegExp {
  const value = glob.trim()
  let source = '^'
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '*') {
      if (value[index + 1] === '*') {
        source += '.*'
        index++
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`${source}$`)
}

export function matches(value: string, glob: string): boolean {
  return globToRegExp(glob).test(value)
}

export function matchesAny(value: string, globs: string[] | undefined): boolean {
  return (globs ?? []).some((glob) => matches(value, glob))
}
