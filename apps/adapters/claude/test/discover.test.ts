import { describe, expect, it } from 'vitest'
import { parseClaudeVersion } from '../src/discover.ts'

describe('Claude discovery', () => {
  it('parses the version from the CLI banner', () => {
    expect(parseClaudeVersion('2.1.325 (Claude Code)')).toBe('2.1.325')
    expect(parseClaudeVersion('claude 2.0.0')).toBe('2.0.0')
    expect(parseClaudeVersion('no version here')).toBeUndefined()
  })
})
