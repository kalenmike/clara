import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const engineSource = fileURLToPath(new URL('../../packages/orchestration/', import.meta.url))
const outputDir = fileURLToPath(new URL('./dist/server/', import.meta.url))

export default defineConfig({
  entry: ['server/index.ts'],
  outDir: 'dist/server',
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  // The web build owns dist/web and runs first.
  clean: false,
  noExternal: [/^@clara\//],
  external: ['@modelcontextprotocol/sdk', '@opencode/client', 'yaml', 'zod', 'better-sqlite3'],
  onSuccess: async () => {
    // The loader resolves ./std and ./default beside the bundle, so the
    // engine's standard packages and default config travel with the Lab too.
    for (const asset of ['std', 'default']) {
      const target = join(outputDir, asset)
      rmSync(target, { recursive: true, force: true })
      cpSync(join(engineSource, asset), target, { recursive: true })
    }
  },
})
