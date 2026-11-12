import { cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const stdSource = fileURLToPath(new URL('../../packages/orchestration/std/', import.meta.url))
const stdTarget = fileURLToPath(new URL('./dist/std/', import.meta.url))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@clara\//],
  external: ['better-sqlite3', 'yaml', '@modelcontextprotocol/sdk', 'zod'],
  onSuccess: async () => {
    // The loader resolves ./std beside the bundle, so the engine's standard
    // packages travel with every built service that embeds it.
    rmSync(stdTarget, { recursive: true, force: true })
    cpSync(stdSource, stdTarget, { recursive: true })
  },
})
