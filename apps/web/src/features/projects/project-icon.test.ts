import { describe, expect, it } from 'vitest'
import { centeredSquare, isProjectIconFile } from './project-icon'

describe('centeredSquare', () => {
  it('crops the wider side evenly', () => {
    expect(centeredSquare(400, 200)).toEqual({ side: 200, sx: 100, sy: 0 })
    expect(centeredSquare(200, 400)).toEqual({ side: 200, sx: 0, sy: 100 })
  })

  it('leaves square images alone', () => {
    expect(centeredSquare(128, 128)).toEqual({ side: 128, sx: 0, sy: 0 })
  })
})

describe('isProjectIconFile', () => {
  it('accepts image MIME types and image extensions', () => {
    expect(isProjectIconFile(new File([], 'icon.png'))).toBe(true)
    expect(isProjectIconFile(new File([], 'logo.SVG', { type: '' }))).toBe(true)
    expect(isProjectIconFile(new File([], 'image', { type: 'image/webp' }))).toBe(true)
  })

  it('rejects non-images', () => {
    expect(isProjectIconFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBe(false)
  })
})
