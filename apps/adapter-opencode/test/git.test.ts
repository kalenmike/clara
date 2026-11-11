import { describe, expect, it } from 'vitest'
import { gitLogCommand, parseGitLog } from '../src/git.ts'

describe('openCode adapter git helpers', () => {
  it('builds a fixed command from the session window', () => {
    const command = gitLogCommand({
      since: Date.UTC(2026, 0, 1),
      until: Date.UTC(2026, 0, 2),
    })
    expect(command).toContain('git log --since=2026-01-01T00:00:00.000Z')
    expect(command).toContain('--until=2026-01-02T00:00:00.000Z')
    expect(command).toContain('-n 10')
  })

  it('parses the record format and skips invalid hashes', () => {
    const separator = '\x1f'
    const record = '\x1e'
    const text = [
      ['abc1234', 'Ada', 'ada@example.com', '2026-01-01T00:00:00.000Z', 'feat: one', 'body'],
      ['not-a-hash', 'Bad', 'bad@example.com', '2026-01-01T00:00:00.000Z', 'bad', ''],
    ]
      .map((fields) => fields.join(separator))
      .join(record)
    expect(parseGitLog(text)).toEqual([
      {
        hash: 'abc1234',
        authorName: 'Ada',
        authorEmail: 'ada@example.com',
        authoredAt: '2026-01-01T00:00:00.000Z',
        subject: 'feat: one',
        body: 'body',
      },
    ])
  })
})
