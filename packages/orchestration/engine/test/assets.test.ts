import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bundledStdDir, defaultConfigPath } from '../src/index.ts'

describe('bundled engine assets', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('prefers the extracted asset root', () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-assets-'))
    try {
      mkdirSync(join(root, 'std', 'software'), { recursive: true })
      writeFileSync(join(root, 'std', 'software', 'index.yml'), 'id: std:software\n')
      mkdirSync(join(root, 'default'), { recursive: true })
      writeFileSync(join(root, 'default', 'index.yml'), 'id: default\n')

      vi.stubEnv('CLARA_ENGINE_ASSETS_DIR', root)

      expect(bundledStdDir()).toBe(join(root, 'std'))
      expect(defaultConfigPath()).toBe(join(root, 'default', 'index.yml'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the module copy when the configured root is incomplete', () => {
    const root = mkdtempSync(join(tmpdir(), 'clara-assets-'))
    try {
      vi.stubEnv('CLARA_ENGINE_ASSETS_DIR', root)

      expect(bundledStdDir()).toBeTruthy()
      expect(defaultConfigPath()).toBeTruthy()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
