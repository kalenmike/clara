import { describe, expect, it } from 'vitest'
import {
  clampComposerHeight,
  composerHeightMax,
  COMPOSER_HEIGHT_DEFAULT,
  COMPOSER_HEIGHT_MAX,
  COMPOSER_HEIGHT_MIN,
} from './storage'

describe('composer height clamping', () => {
  it('keeps a height between the minimum and the viewport cap', () => {
    expect(clampComposerHeight(COMPOSER_HEIGHT_DEFAULT, 900)).toBe(COMPOSER_HEIGHT_DEFAULT)
  })

  it('clamps below the minimum', () => {
    expect(clampComposerHeight(20, 900)).toBe(COMPOSER_HEIGHT_MIN)
  })

  it('caps at the hard maximum on a tall viewport', () => {
    expect(composerHeightMax(2000)).toBe(COMPOSER_HEIGHT_MAX)
    expect(clampComposerHeight(1000, 2000)).toBe(COMPOSER_HEIGHT_MAX)
  })

  it('leaves thread room on a short viewport', () => {
    expect(composerHeightMax(500)).toBe(300)
    expect(clampComposerHeight(500, 500)).toBe(300)
  })

  it('never goes below the minimum on a tiny viewport', () => {
    expect(composerHeightMax(280)).toBe(COMPOSER_HEIGHT_MIN)
    expect(clampComposerHeight(COMPOSER_HEIGHT_DEFAULT, 280)).toBe(COMPOSER_HEIGHT_MIN)
  })

  it('rounds fractional heights', () => {
    expect(clampComposerHeight(320.6, 900)).toBe(321)
  })
})
