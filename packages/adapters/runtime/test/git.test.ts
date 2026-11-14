import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findFiles } from '../src/files.ts'
import { gitLog, vcsBase, vcsDiff, vcsInfo, vcsStatus, worktrees } from '../src/git.ts'

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'clara-git-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  writeFileSync(join(directory, 'readme.md'), 'first\n')
  git('add', 'readme.md')
  git('commit', '-m', 'initial commit')
  writeFileSync(join(directory, 'readme.md'), 'first\nsecond\n')
  writeFileSync(join(directory, 'new.txt'), 'new\n')
  mkdirSync(join(directory, 'src'))
  writeFileSync(join(directory, 'src', 'app.ts'), 'export const app = true\n')
  return directory
}

describe('Claude git helpers', () => {
  it('reports branch, base, status, and worktrees', async () => {
    const directory = repository()
    expect((await vcsInfo(directory)).data).toMatchObject({
      provider: 'git',
      branch: { current: 'main', default: 'main' },
    })
    expect((await vcsBase(directory)).data?.name).toBe('main')
    expect((await vcsStatus(directory)).data.map((entry) => entry.file)).toEqual([
      'new.txt',
      'readme.md',
      'src/app.ts',
    ])
    expect((await worktrees(directory)).map((entry) => entry.directory)).toContain(directory)
  })

  it('builds a working diff with tracked and untracked files', async () => {
    const directory = repository()
    const diff = await vcsDiff(directory, { mode: 'working', context: 0 })
    expect(diff.data.find((entry) => entry.file === 'readme.md')).toMatchObject({
      status: 'modified',
      additions: 1,
      deletions: 0,
    })
    expect(diff.data.find((entry) => entry.file === 'new.txt')).toMatchObject({
      status: 'added',
      additions: 1,
    })
  })

  it('reads commits in the session window', async () => {
    const directory = repository()
    const commits = await gitLog(directory, { since: 0 })
    expect(commits[0]).toMatchObject({ subject: 'initial commit' })
  })

  it('finds files for composer mentions', () => {
    const directory = repository()
    const matches = findFiles({ directory, query: 'app', type: 'file' })
    expect(matches.map((entry) => entry.path)).toContain(join(directory, 'src', 'app.ts'))
  })
})
