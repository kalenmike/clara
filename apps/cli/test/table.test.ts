import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyColorChoice } from '../src/ui/color.ts'
import { renderTable } from '../src/ui/table.ts'

describe('renderTable', () => {
  beforeEach(() => applyColorChoice('never'))

  it('aligns columns and right-aligns numbers', () => {
    const table = renderTable(
      [
        { name: 'hub', count: 2 },
        { name: 'engine', count: 14 },
      ],
      [
        { header: 'NAME', value: (row) => row.name },
        { header: 'COUNT', value: (row) => String(row.count), align: 'right' },
      ]
    )
    expect(table).toBe(['NAME    COUNT', 'hub         2', 'engine     14'].join('\n'))
  })

  it('ignores color escapes when computing width', () => {
    const table = renderTable(
      [{ name: '\u001b[32mhub\u001b[39m' }],
      [{ header: 'NAME', value: (row) => row.name }]
    )
    expect(table.split('\n')[0]).toBe('NAME')
  })

  it('renders plain text when colors are disabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clara-table-'))
    try {
      expect(dir).toContain('clara-table-')
      expect(renderTable([], [{ header: 'NAME', value: () => '' }])).toBe('NAME')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('cleanup', () => {
  afterEach(() => applyColorChoice('auto'))
  it('keeps the color choice scoped', () => {
    applyColorChoice('never')
    expect(renderTable([{ name: 'x' }], [{ header: 'N', value: (row) => row.name }])).toBe(
      ['N', 'x'].join('\n')
    )
  })
})
