import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [/^@clara\//],
  external: ['better-sqlite3', 'yaml', '@modelcontextprotocol/sdk', 'zod'],
})
