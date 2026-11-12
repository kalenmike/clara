import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function packageRoot(name: string): string {
  try {
    return dirname(require.resolve(`${name}/package.json`))
  } catch {
    return dirname(require.resolve(name))
  }
}

/** The MCP bridge registered with OpenCode when `--mcp` is used. */
export function mcpEntryPath(): string {
  const path = join(packageRoot('@clara/mcp'), 'dist', 'index.js')
  if (!existsSync(path)) {
    throw new Error('The MCP bridge is not built. Run `pnpm build` and retry.')
  }
  return path
}

/** The OpenCode policy plugin shipped inside this adapter. */
export function openCodePluginRoot(): string {
  const built = fileURLToPath(new URL('./plugin', import.meta.url))
  if (existsSync(join(built, 'index.js'))) return built
  return fileURLToPath(new URL('../plugin', import.meta.url))
}

export function openCodeAgentSource(): string {
  return join(openCodePluginRoot(), 'agents', 'clara.md')
}

/** The hub-facing adapter daemon entry. */
export function openCodeAdapterDaemonEntry(): string {
  const candidates = [
    fileURLToPath(new URL('./index.js', import.meta.url)),
    fileURLToPath(new URL('./index.ts', import.meta.url)),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return fileURLToPath(new URL('./index.ts', import.meta.url))
}
