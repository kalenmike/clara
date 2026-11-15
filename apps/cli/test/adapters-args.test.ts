import { describe, expect, it } from 'vitest'
import { parseAdapterArgs, parseKindSpec, parseTransport } from '../src/commands/adapter-args.ts'

describe('adapter argument parsing', () => {
  it('parses kinds and pinned versions', () => {
    expect(parseKindSpec('opencode')).toEqual({ kind: 'opencode' })
    expect(parseKindSpec('claude@2.0.0')).toEqual({ kind: 'claude', version: '2.0.0' })
  })

  it('rejects unknown kinds and malformed pins', () => {
    expect(() => parseKindSpec('vim')).toThrow('unknown adapter')
    expect(() => parseKindSpec('opencode@')).toThrow('invalid adapter target')
    expect(() => parseKindSpec('opencode@1@2')).toThrow('invalid adapter target')
  })

  it('parses flags, spaced options, and equals options', () => {
    const parsed = parseAdapterArgs([
      'opencode@1.0.0',
      '--no-start',
      '--pair',
      'clara-pair',
      '--transport=relay',
      '--container',
      'clara-adapter-opencode',
      '--json',
    ])
    expect(parsed.values).toEqual(['opencode@1.0.0'])
    expect([...parsed.flags]).toEqual(['--no-start', '--json'])
    expect(parsed.options.get('--pair')).toBe('clara-pair')
    expect(parsed.options.get('--transport')).toBe('relay')
    expect(parsed.options.get('--container')).toBe('clara-adapter-opencode')
  })

  it('rejects unknown options and missing values', () => {
    expect(() => parseAdapterArgs(['--wat'])).toThrow('unknown option')
    expect(() => parseAdapterArgs(['--pair'])).toThrow('needs a value')
    expect(() => parseAdapterArgs(['--pair', '--json'])).toThrow('needs a value')
  })

  it('accepts local, relay, and docker transports', () => {
    expect(parseTransport(undefined)).toBe('local')
    expect(parseTransport('relay')).toBe('relay')
    expect(parseTransport('docker')).toBe('docker')
    expect(() => parseTransport('carrier-pigeon')).toThrow('local, relay, or docker')
  })
})
