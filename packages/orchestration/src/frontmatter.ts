import { parse } from 'yaml'

export interface MarkdownDocument {
  data: Record<string, unknown>
  body: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseMarkdownDocument(text: string, path: string): MarkdownDocument {
  if (!text.startsWith('---')) return { data: {}, body: text.trim() }
  const end = text.indexOf('\n---', 3)
  if (end === -1) throw new Error(`${path}: frontmatter is not closed`)
  const front = text.slice(3, end).trim()
  const body = text
    .slice(end + 4)
    .replace(/^\s*\n/, '')
    .trim()
  const parsed: unknown = parse(front)
  return { data: isRecord(parsed) ? parsed : {}, body }
}

export function parseYamlRecord(text: string, path: string): Record<string, unknown> {
  const parsed: unknown = parse(text)
  if (!isRecord(parsed)) throw new Error(`${path}: expected a YAML object`)
  return parsed
}
