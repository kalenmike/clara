import { useColor } from './color.ts'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export type Spinner = {
  update(text: string): void
  succeed(text: string): void
  fail(text: string): void
  stop(): void
}

/** A TTY-only spinner; every call is a no-op in pipes, CI, and JSON output. */
export function startSpinner(initial: string): Spinner {
  const animated = useColor() && Boolean(process.stdout.isTTY) && process.env.CI === undefined
  let text = initial
  let frame = 0
  let timer: NodeJS.Timeout | undefined

  const draw = () => {
    if (!animated) return
    const glyph = FRAMES[frame % FRAMES.length]
    frame += 1
    process.stdout.write(`\r\u001b[2K${glyph} ${text}`)
  }

  const finish = (line: string) => {
    if (timer) clearInterval(timer)
    timer = undefined
    if (animated) process.stdout.write(`\r\u001b[2K${line}\n`)
    else process.stdout.write(`${line}\n`)
  }

  if (animated) {
    draw()
    timer = setInterval(draw, 80)
  }

  return {
    update(next: string) {
      text = next
      if (animated) draw()
    },
    succeed(message: string) {
      finish(`\u001b[32m✔\u001b[39m ${message}`)
    },
    fail(message: string) {
      finish(`\u001b[31m✖\u001b[39m ${message}`)
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
      if (animated) process.stdout.write('\r\u001b[2K')
    },
  }
}
