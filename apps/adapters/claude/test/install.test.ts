import { describe, expect, it } from 'vitest'
import { parseInstallOptions } from '../src/install.ts'

describe('Claude install options', () => {
  it('reads harness flags', () => {
    expect(
      parseInstallOptions([
        '--pair',
        'clara-harness1_code',
        '--claude-path',
        '/usr/local/bin/claude',
        '--model',
        'sonnet',
        '--agent',
        'reviewer',
        '--permission-mode',
        'plan',
        '--max-turns',
        '12',
        '--max-budget',
        '3.5',
        '--concurrency',
        '4',
        '--additional-directory',
        '/work',
        '--additional-directory',
        '/data',
        '--no-service',
        '--skip-auth-check',
        '--dry-run',
      ])
    ).toEqual({
      pair: 'clara-harness1_code',
      claudePath: '/usr/local/bin/claude',
      model: 'sonnet',
      agent: 'reviewer',
      permissionMode: 'plan',
      noService: true,
      skipAuthCheck: true,
      dryRun: true,
      force: false,
      maxTurns: 12,
      maxBudgetUsd: 3.5,
      concurrency: 4,
      additionalDirectories: ['/work', '/data'],
    })
  })

  it('rejects an unknown permission mode', () => {
    expect(() => parseInstallOptions(['--permission-mode', 'yolo'])).toThrow(/permission-mode/)
  })
})
