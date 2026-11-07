import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['server/index.ts'],
  outDir: 'dist/server',
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  // The web build owns dist/web and runs first.
  clean: false,
  noExternal: [/^@clara\//],
  external: ['@modelcontextprotocol/sdk', 'yaml', 'zod', 'better-sqlite3'],
})
