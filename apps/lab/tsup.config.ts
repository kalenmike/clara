import { cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const stdSource = fileURLToPath(new URL('../../packages/orchestration/std/', import.meta.url))
const stdTarget = fileURLToPath(new URL('./dist/server/std/', import.meta.url))

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
    // The loader resolves ./std beside the bundle, so the engine's standard
    // packages travel with the built Lab too.
    rmSync(stdTarget, { recursive: true, force: true })
    cpSync(stdSource, stdTarget, { recursive: true })
  },
})
