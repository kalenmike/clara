import { describe, expect, it } from 'vitest'
import { defaultServices, resolveServices } from '../src/service/lifecycle.ts'
import { ordered, START_ORDER, STOP_ORDER } from '../src/service/specs.ts'

describe('service selection', () => {
  it('starts engine before hub before web', () => {
    expect(defaultServices()).toEqual(['engine', 'hub', 'web'])
    expect(ordered(['web', 'engine', 'hub'], START_ORDER)).toEqual(['engine', 'hub', 'web'])
    expect(ordered(['web', 'engine', 'hub'], STOP_ORDER)).toEqual(['web', 'hub', 'engine'])
  })

  it('splits comma lists and drops unknown values', () => {
    expect(resolveServices(['hub,web'])).toEqual(['hub', 'web'])
    expect(resolveServices(['bogus'])).toEqual([])
    expect(resolveServices([])).toEqual([])
  })
})
