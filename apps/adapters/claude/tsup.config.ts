import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@clara\//],
  // The Agent SDK resolves its bundled native binary and control protocol from
  // its own package, so it must stay external.
  external: [/^@anthropic-ai\//, 'ws'],
})
