import { describe, expect, it } from 'vitest'
import { modelsForHarness } from './use-catalog'

describe('modelsForHarness', () => {
  const catalogs = new Map<string, readonly string[]>([
    ['active', ['active-model']],
    ['harness-one', ['one-model']],
  ])

  it('reads the session harness catalog for cost estimates', () => {
    expect(modelsForHarness(catalogs, 'harness-one')).toEqual(['one-model'])
  })

  it('falls back to the active catalog when the harness is unknown', () => {
    expect(modelsForHarness(catalogs, undefined)).toEqual(['active-model'])
  })
})
