import { describe, expect, it } from 'vitest'
import type { ClaraSessionMessage } from '@clara/api-contract'
import {
  lastSessionActivity,
  parseConventionalHeader,
  resolveWorktrees,
  splitCommitBody,
} from './use-git'

describe('lastSessionActivity', () => {
  function user(created: number): ClaraSessionMessage {
    return { id: `user-${created}`, time: { created }, type: 'user', text: 'hi' }
  }

  function assistant(created: number, completed?: number): ClaraSessionMessage {
    return {
      id: `assistant-${created}`,
      time: { created, ...(completed !== undefined ? { completed } : {}) },
      type: 'assistant',
      agent: 'build',
      model: { id: 'claude', providerID: 'anthropic' },
      content: [],
    }
  }

  it('uses the assistant completion time, not its creation time', () => {
    expect(lastSessionActivity([user(100), assistant(200, 500)])).toBe(500)
  })

  it('uses the newest creation when no message has completed', () => {
    expect(lastSessionActivity([user(100), assistant(200)])).toBe(200)
  })

  it('returns undefined for an empty session', () => {
    expect(lastSessionActivity([])).toBeUndefined()
  })
})

describe('parseConventionalHeader', () => {
  it('splits type, scope, and description', () => {
    expect(parseConventionalHeader('fix(web): poll a shell job for its full timeout')).toEqual({
      type: 'fix',
      scope: 'web',
      breaking: false,
      description: 'poll a shell job for its full timeout',
    })
  })

  it('reads breaking markers with and without a scope', () => {
    expect(parseConventionalHeader('feat(api)!: drop the old route')).toMatchObject({
      type: 'feat',
      scope: 'api',
      breaking: true,
    })
    expect(parseConventionalHeader('feat!: drop the old route')).toMatchObject({
      type: 'feat',
      scope: undefined,
      breaking: true,
    })
  })

  it('lowercases the type and trims the description', () => {
    expect(parseConventionalHeader('  FEAT(web):   add a row  ')).toEqual({
      type: 'feat',
      scope: 'web',
      breaking: false,
      description: 'add a row',
    })
  })

  it('ignores subjects that are not conventional', () => {
    expect(parseConventionalHeader('Update the docs')).toBeUndefined()
    expect(parseConventionalHeader('fix - no colon')).toBeUndefined()
    expect(parseConventionalHeader('fix:')).toBeUndefined()
  })
})

describe('splitCommitBody', () => {
  it('pulls co-authors out and keeps the rest', () => {
    expect(
      splitCommitBody(
        [
          'Keep the change.',
          '',
          'Co-authored-by: Ada Lovelace <ada@example.com>',
          'Co-authored-by: Grace Hopper <grace@example.com>',
        ].join('\n')
      )
    ).toEqual({
      message: 'Keep the change.',
      coAuthors: [
        { name: 'Ada Lovelace', email: 'ada@example.com' },
        { name: 'Grace Hopper', email: 'grace@example.com' },
      ],
    })
  })

  it('falls back to the address when a trailer has no name', () => {
    expect(splitCommitBody('Co-authored-by: <ada@example.com>')).toEqual({
      message: '',
      coAuthors: [{ name: 'ada@example.com', email: 'ada@example.com' }],
    })
  })

  it('keeps other trailers and empty bodies', () => {
    expect(splitCommitBody('Signed-off-by: Ada <ada@example.com>')).toEqual({
      message: 'Signed-off-by: Ada <ada@example.com>',
      coAuthors: [],
    })
    expect(splitCommitBody('')).toEqual({ message: '', coAuthors: [] })
  })
})

describe('resolveWorktrees', () => {
  const canonical = '/home/jet/Projects/clara'
  const worktree = '/home/jet/.local/share/opencode/worktree/c6656f/relay-split'

  it('marks the default and current rows and sorts them first', () => {
    const rows = resolveWorktrees(
      [
        { directory: worktree, strategy: 'git' },
        { directory: canonical },
        { directory: '/home/jet/Projects/other' },
      ],
      canonical,
      worktree
    )

    expect(rows.map((row) => row.directory)).toEqual([
      canonical,
      worktree,
      '/home/jet/Projects/other',
    ])
    expect(rows[0]).toMatchObject({ isDefault: true, isCurrent: false })
    expect(rows[1]).toMatchObject({ isDefault: false, isCurrent: true })
    expect(rows[2]).toMatchObject({ isDefault: false, isCurrent: false })
  })

  it('synthesizes the default row when the server omits it', () => {
    const rows = resolveWorktrees([{ directory: worktree }], canonical, canonical)
    expect(rows[0]).toMatchObject({
      directory: canonical,
      isDefault: true,
      isCurrent: true,
    })
  })

  it('normalizes trailing separators and backslashes', () => {
    const rows = resolveWorktrees(
      [{ directory: `${canonical}/` }, { directory: 'C:\\repo\\lane\\' }],
      canonical,
      'C:/repo/lane'
    )
    expect(rows[0]?.isDefault).toBe(true)
    expect(rows[1]?.isCurrent).toBe(true)
  })

  it('does not treat a sibling path as the current worktree', () => {
    const rows = resolveWorktrees([{ directory: `${canonical}-next` }], canonical, canonical)
    expect(rows.find((row) => row.directory === `${canonical}-next`)?.isCurrent).toBe(false)
  })

  it('handles an empty list', () => {
    expect(resolveWorktrees([], undefined, undefined)).toEqual([])
  })
})
