import { createInterface } from 'node:readline/promises'

export async function promptLine(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''} `)).trim()
    return answer || fallback || ''
  } finally {
    rl.close()
  }
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = await promptLine(`${question} ${fallback ? '[Y/n]' : '[y/N]'}`)
  if (!answer) return fallback
  return /^y(es)?$/i.test(answer)
}

/** Read a password without echoing it when stdin is a terminal. */
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return (await rl.question(question)).trim()
    } finally {
      rl.close()
    }
  }

  return new Promise<string>((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''

    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      process.stdout.write('\n')
      resolve(value)
    }

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (char === '\r' || char === '\n') {
          finish()
          return
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += char
      }
    }

    stdin.on('data', onData)
  })
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}
