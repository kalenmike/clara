/**
 * Runs the real `serve` loop in its own process so a test can observe whether
 * the adapter survives losing the hub connection.
 */
import { Hono } from 'hono'
import { runAdapterCli, type AdapterDefinition } from '../../src/cli.ts'
import { writeAdapterConfig } from '../../src/config.ts'
import type { AdapterPaths } from '../../src/types.ts'

const wsUrl = process.argv[2]
if (!wsUrl) throw new Error('Pass the hub WebSocket URL')
const dir = process.env.CLARA_TEST_DIR
if (!dir) throw new Error('Pass CLARA_TEST_DIR')

const paths: AdapterPaths = {
  name: 'test',
  configDir: `${dir}/config`,
  dataDir: `${dir}/data`,
  configPath: `${dir}/config/adapter.json`,
  identityPath: `${dir}/data/identity.json`,
  logPath: `${dir}/data/adapter.log`,
  pidPath: `${dir}/data/adapter.pid`,
  statePath: `${dir}/data/state.json`,
}

writeAdapterConfig(paths, {
  harnessId: 'harness-test',
  adapterId: 'adapter-test',
  // The fake hub never completes a handshake, so the key is never used.
  key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  wsUrl,
  grant: '',
  label: 'Test',
})

const definition: AdapterDefinition<Record<string, never>> = {
  name: 'test',
  version: '0.0.0',
  label: 'Test',
  capabilities: {},
  paths,
  probe: async () => ({ ok: true, latencyMs: 1, code: 'ok' }),
  createApp: () => new Hono(),
  describe: () => ({ url: 'test://harness' }),
  resolveHarness: async () => ({}),
}

await runAdapterCli(definition, ['serve', '--ws-url', wsUrl])
