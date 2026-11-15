import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { staticRootCandidates } from '../src/static.ts'

const labRoot = resolve('/tmp', 'clara-lab')

describe('lab static root resolution', () => {
  it('looks in dist/web when the server runs from source', () => {
    expect(staticRootCandidates(resolve(labRoot, 'server'))).toEqual([
      resolve(labRoot, 'web'),
      resolve(labRoot, 'dist', 'web'),
    ])
  })

  it('looks in dist/web when the server runs from the bundle', () => {
    expect(staticRootCandidates(resolve(labRoot, 'dist', 'server'))[0]).toBe(
      resolve(labRoot, 'dist', 'web')
    )
  })
})
