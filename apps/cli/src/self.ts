import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * How this process re-executes itself for a service child.
 *
 * A compiled `clara` binary starts itself with a hidden command. A source
 * checkout runs the TypeScript entry through tsx, matching `pnpm dev`.
 */
export function selfCommand(args: readonly string[]): { command: string; args: string[] } {
  const executable = basename(process.execPath).replace(/\.exe$/i, '')
  const entry = fileURLToPath(new URL('./main.ts', import.meta.url))
  if (executable === 'node') {
    return { command: process.execPath, args: ['--import', tsxLoader(), entry, ...args] }
  }
  if (executable === 'bun') {
    return { command: process.execPath, args: [entry, ...args] }
  }
  return { command: process.execPath, args: [...args] }
}

export function isCompiled(): boolean {
  const executable = basename(process.execPath).replace(/\.exe$/i, '')
  return executable !== 'node' && executable !== 'bun'
}

function tsxLoader(): string {
  try {
    return createRequire(import.meta.url).resolve('tsx')
  } catch {
    return 'tsx'
  }
}
