import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts', 'src/install-cli.ts', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  platform: 'node',
  target: 'node22',
})
