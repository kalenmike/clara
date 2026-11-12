import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          CLARA_AGENT_TOKEN: 'agent-test-token',
          CLARA_CLIENT_TOKEN: 'client-test-token',
        },
      },
    }),
  ],
})
