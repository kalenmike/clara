import { defineConfig } from 'tsup'
import { featureEnabled } from '../../../tools/build/feature-flags.mjs'

const cloudflareDeployment = featureEnabled(process.env.ENABLE_CLOUDFLARE_DEPLOYMENT)

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@clara\//],
  define: {
    'process.env.ENABLE_CLOUDFLARE_DEPLOYMENT': JSON.stringify(
      cloudflareDeployment ? 'true' : 'false'
    ),
  },
})
