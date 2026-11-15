type Choice = 'auto' | 'always' | 'never'

let override: boolean | undefined

function detect(): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '') return false
  if (process.env.FORCE_COLOR === '0') return false
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '') return true
  if (process.env.TERM === 'dumb') return false
  return Boolean(process.stdout.isTTY)
}

export function useColor(): boolean {
  return override ?? detect()
}

/** Apply an explicit `--color/--no-color` choice from the command line. */
export function applyColorChoice(choice: Choice): void {
  override = choice === 'always' ? true : choice === 'never' ? false : undefined
}

function wrap(open: string, close: string): (text: string) => string {
  return (text) => (useColor() ? `\u001b[${open}m${text}\u001b[${close}m` : text)
}

export const bold = wrap('1', '22')
export const dim = wrap('2', '22')
export const red = wrap('31', '39')
export const green = wrap('32', '39')
export const yellow = wrap('33', '39')
export const blue = wrap('34', '39')
export const magenta = wrap('35', '39')
export const cyan = wrap('36', '39')
