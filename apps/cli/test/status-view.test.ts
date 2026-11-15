import { beforeEach, describe, expect, it } from 'vitest'
import type { ServiceStatus } from '../src/service/lifecycle.ts'
import { mismatchNote, statusColumns } from '../src/service/status-view.ts'
import { applyColorChoice } from '../src/ui/color.ts'
import { renderTable } from '../src/ui/table.ts'

const expected = { version: '0.2.0', protocol: 4 }

function service(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    name: 'hub',
    state: 'running',
    pid: 4321,
    url: 'http://127.0.0.1:8790',
    port: 8790,
    uptimeMs: 65_000,
    restarts: 0,
    managed: true,
    ...overrides,
  }
}

beforeEach(() => applyColorChoice('never'))

describe('status columns', () => {
  it('shows the version and protocol a service reports', () => {
    const [header, row] = renderTable(
      [service({ version: '0.2.0', protocol: 4 })],
      statusColumns(expected)
    ).split('\n')
    expect(header).toContain('VERSION')
    expect(header).toContain('PROTOCOL')
    expect(row).toContain('0.2.0')
    expect(row).toMatch(/\s4\s/)
  })

  it('leaves unknown values blank instead of guessing', () => {
    const row = renderTable([service()], statusColumns(expected)).split('\n')[1]
    expect(row).toMatch(/\s-\s+-\s/)
  })

  it('marks a service that differs from this command', () => {
    const table = renderTable([service({ version: '0.1.0', protocol: 3 })], statusColumns(expected))
    expect(table.split('\n')[1]).toContain('0.1.0*')
    expect(table.split('\n')[1]).toContain('3*')
  })

  it('does not judge a service that reports nothing', () => {
    expect(mismatchNote([service()], expected)).toBeUndefined()
  })
})

describe('mismatch note', () => {
  it('explains a version difference', () => {
    expect(mismatchNote([service({ version: '0.1.0' })], expected)).toContain('restart the stack')
  })

  it('explains a protocol difference', () => {
    expect(mismatchNote([service({ protocol: 3 })], expected)).toContain('restart the stack')
  })

  it('stays quiet when the running build matches the command', () => {
    expect(mismatchNote([service({ version: '0.2.0', protocol: 4 })], expected)).toBeUndefined()
  })

  it('does not judge an unknown command version', () => {
    expect(mismatchNote([service({ version: '0.1.0' })], { version: '0.0.0', protocol: 4 })).toBe(
      undefined
    )
  })
})
