import { describe, expect, it } from 'vitest'
import { modelsForHarness } from './use-catalog'

describe('modelsForHarness', () => {
  const catalogs = new Map<string, readonly string[]>([
    ['none', ['unknown-model']],
    ['harness-one', ['one-model']],
  ])

  it('reads the session harness catalog for cost estimates', () => {
    expect(modelsForHarness(catalogs, 'harness-one')).toEqual(['one-model'])
  })

  it('does not borrow another harness catalog when the harness is unknown', () => {
    expect(modelsForHarness(catalogs, undefined)).toEqual(['unknown-model'])
  })
})
