import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openCodeServiceFile, resolveOpenCodeConfig } from '../server/models.ts'
import { explainOpenCodeError } from '../server/opencode.ts'

const keys = ['CLARA_OPENCODE_URL', 'CLARA_OPENCODE_PASSWORD', 'XDG_STATE_HOME'] as const
let saved: Record<string, string | undefined> = {}
let stateHome = ''

beforeEach(() => {
  saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  stateHome = mkdtempSync(join(tmpdir(), 'clara-lab-auth-'))
  process.env.XDG_STATE_HOME = stateHome
  delete process.env.CLARA_OPENCODE_URL
  delete process.env.CLARA_OPENCODE_PASSWORD
})

afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(stateHome, { recursive: true, force: true })
})

describe('OpenCode authentication config', () => {
  it('uses CLARA_OPENCODE_PASSWORD without requiring CLARA_OPENCODE_URL', () => {
    process.env.CLARA_OPENCODE_PASSWORD = 'secret'
    expect(resolveOpenCodeConfig()).toEqual({
      url: 'http://127.0.0.1:4096',
      password: 'secret',
      source: 'env',
      serviceFile: openCodeServiceFile(),
    })
  })

  it('reads the service file when environment variables are unset', () => {
    mkdirSync(join(stateHome, 'opencode'))
    const file = join(stateHome, 'opencode', 'service.json')
    const url = 'http://127.0.0.1:4555'
    const password = 'service-secret'
    writeFileSync(file, JSON.stringify({ url, password }))
    expect(resolveOpenCodeConfig()).toEqual({
      url,
      password,
      source: 'service',
      serviceFile: file,
    })
  })
})

describe('OpenCode error guidance', () => {
  it('explains how to fix a missing password', () => {
    const result = explainOpenCodeError('Authentication required', {
      url: 'http://127.0.0.1:4096',
      serviceFile: '/home/dev/.local/state/opencode/service.json',
    })
    expect(result.kind).toBe('auth')
    expect(result.hint).toContain('pnpm clara pass')
    expect(result.hint).toContain('CLARA_OPENCODE_PASSWORD')
    expect(result.hint).toContain('/home/dev/.local/state/opencode/service.json')
  })

  it('points at the URL when OpenCode is unreachable', () => {
    const result = explainOpenCodeError('fetch failed', {
      url: 'http://127.0.0.1:9999',
      serviceFile: '/tmp/service.json',
    })
    expect(result.kind).toBe('connection')
    expect(result.hint).toContain('http://127.0.0.1:9999')
  })
})
