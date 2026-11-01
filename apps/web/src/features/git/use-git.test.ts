import { describe, expect, it } from 'vitest'
import { parseConventionalHeader, parseGitLog, resolveWorktrees, splitCommitBody } from './use-git'

const FIELD = '\x1f'
const RECORD = '\x1e'

function record(fields: string[]): string {
  return `${fields.join(FIELD)}${RECORD}`
}

describe('parseGitLog', () => {
  it('reads full records and multiline bodies', () => {
    const body = 'Record the new way to open the panel.\n\nIt also notes the proxy.'
    expect(
      parseGitLog(
        [
          record([
            'abc1234',
            'Ada Lovelace',
            'ada@example.com',
            '2026-11-01T17:29:23+01:00',
            'feat(web): add commits',
            body,
          ]),
          record([
            'def5678',
            'Grace Hopper',
            'grace@example.com',
            '2026-10-31T09:00:00Z',
            'fix: edge case',
            '',
          ]),
        ].join('\n')
      )
    ).toEqual([
      {
        hash: 'abc1234',
        authorName: 'Ada Lovelace',
        authorEmail: 'ada@example.com',
        authoredAt: '2026-11-01T17:29:23+01:00',
        subject: 'feat(web): add commits',
        body,
      },
      {
        hash: 'def5678',
        authorName: 'Grace Hopper',
        authorEmail: 'grace@example.com',
        authoredAt: '2026-10-31T09:00:00Z',
        subject: 'fix: edge case',
        body: '',
      },
    ])
  })

  it('keeps quotes, hashes, and spacing inside the subject', () => {
    const [commit] = parseGitLog(
      record([
        'abc1234',
        'Ada',
        'ada@example.com',
        '2026-11-01T17:29:23+01:00',
        'fix: "quoted" #hash  double space',
        '',
      ])
    )
    expect(commit?.subject).toBe('fix: "quoted" #hash  double space')
  })

  it('handles CRLF between records', () => {
    const value = `${record(['abc1234', 'Ada', 'ada@example.com', '2026-11-01T17:29:23Z', 'fix: one', ''])}\r\n${record(['def5678', 'Grace', 'grace@example.com', '2026-10-31T09:00:00Z', 'fix: two', ''])}`
    expect(parseGitLog(value).map((commit) => commit.hash)).toEqual(['abc1234', 'def5678'])
  })

  it('ignores noise and empty output', () => {
    expect(parseGitLog('')).toEqual([])
    expect(parseGitLog('fatal: not a git repository')).toEqual([])
    expect(parseGitLog('not-a-hash value')).toEqual([])
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
