import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function packageRoot(name: string): string {
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    // Packages with an exports map may not expose package.json. Fall back to
    // resolving the entry point and keeping its directory.
    return dirname(require.resolve(name))
  }
}

export function openCodeAdapterRoot(): string {
  return packageRoot('@clara/opencode-policy-plugin')
}

export function openCodeAgentSource(): string {
  return join(openCodeAdapterRoot(), 'agents', 'clara.md')
}

/** The hub-facing adapter daemon entry. */
export function openCodeAdapterDaemonEntry(): string {
  const root = packageRoot('@clara/adapter-opencode')
  const built = join(root, 'dist', 'index.js')
  if (existsSync(built)) return built
  const source = join(root, 'src', 'index.ts')
  if (existsSync(source)) return source
  throw new Error(
    'The OpenCode adapter is not built. Run `pnpm --filter @clara/adapter-opencode build` and retry.'
  )
}

export function mcpEntryPath(): string {
  const path = join(packageRoot('@clara/mcp'), 'dist', 'index.js')
  if (!existsSync(path)) {
    throw new Error('The MCP bridge is not built. Run `pnpm build` and retry.')
  }
  return path
}

/** The running CLI entry, used by the generated user service. */
export function cliEntry(): string {
  const entry = process.argv[1]
  return entry ? resolve(entry) : fileURLToPath(import.meta.url)
}
