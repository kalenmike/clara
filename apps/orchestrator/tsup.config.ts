import { cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const engineSource = fileURLToPath(new URL('../../packages/orchestration/engine/', import.meta.url))
const outputDir = fileURLToPath(new URL('./dist/', import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@clara\//],
  external: ['better-sqlite3', 'yaml', '@modelcontextprotocol/sdk', 'zod'],
  onSuccess: async () => {
    // The loader resolves ./std and ./default beside the bundle, so the
    // engine's standard packages and default config travel with the service.
    for (const asset of ['std', 'default']) {
      const target = join(outputDir, asset)
      rmSync(target, { recursive: true, force: true })
      cpSync(join(engineSource, asset), target, { recursive: true })
    }
  },
})
