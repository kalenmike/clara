import { useColor } from './color.ts'

/**
 * Status glyphs. Plain fallbacks keep logs, CI, and `--json` pipelines
 * readable when colors are disabled.
 */
export const symbols = {
  get ok(): string {
    return useColor() ? '✔' : 'ok'
  },
  get fail(): string {
    return useColor() ? '✖' : 'x'
  },
  get warn(): string {
    return useColor() ? '▲' : '!'
  },
  get dot(): string {
    return useColor() ? '●' : '*'
  },
  get idle(): string {
    return useColor() ? '○' : '-'
  },
  get arrow(): string {
    return useColor() ? '›' : '>'
  },
}
