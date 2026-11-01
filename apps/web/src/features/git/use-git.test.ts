import { describe, expect, it } from 'vitest'
import { parseOneline, resolveWorktrees } from './use-git'

describe('parseOneline', () => {
  it('reads short hashes and subjects', () => {
    expect(
      parseOneline(
        [
          '5b14115 docs: track confirmed plans in the session todo list',
          '1070b01 fix: consume pairing links before router boot',
          '',
        ].join('\n')
      )
    ).toEqual([
      { hash: '5b14115', subject: 'docs: track confirmed plans in the session todo list' },
      { hash: '1070b01', subject: 'fix: consume pairing links before router boot' },
    ])
  })

  it('keeps hashes, quotes, and spacing inside the subject', () => {
    expect(parseOneline('abc1234 fix: "quoted" #hash  double space')).toEqual([
      { hash: 'abc1234', subject: 'fix: "quoted" #hash  double space' },
    ])
  })

  it('ignores noise and empty output', () => {
    expect(parseOneline('')).toEqual([])
    expect(parseOneline('fatal: not a git repository')).toEqual([])
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
