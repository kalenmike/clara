import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { staticRootCandidates } from '../server/static.ts'

const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('lab static root resolution', () => {
  it('looks in dist/web when the server runs from source', () => {
    const source = pathToFileURL(resolve(labRoot, 'server', 'static.ts'))
    expect(staticRootCandidates(source)).toEqual([
      resolve(labRoot, 'web'),
      resolve(labRoot, 'dist', 'web'),
    ])
  })

  it('looks in dist/web when the server runs from the bundle', () => {
    const bundled = pathToFileURL(resolve(labRoot, 'dist', 'server', 'index.js'))
    expect(staticRootCandidates(bundled)[0]).toBe(resolve(labRoot, 'dist', 'web'))
  })
})
