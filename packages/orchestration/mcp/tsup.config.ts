import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/bin.ts' },
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  external: ['@modelcontextprotocol/sdk', 'zod'],
})
