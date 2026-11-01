import { useMediaQuery } from './use-media-query'

/**
 * True on touch-first devices such as phones and tablets. A touchscreen laptop
 * keeps a fine primary pointer while a mouse or trackpad is in use, so it still
 * counts as a desktop device.
 */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(pointer: coarse)')
}
