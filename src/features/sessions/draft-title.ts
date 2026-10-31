const DRAFT_TITLE_LENGTH = 50

/** Turn a first message into a short, single-line session title. */
export function draftTitleFromText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= DRAFT_TITLE_LENGTH) return normalized
  return `${normalized.slice(0, DRAFT_TITLE_LENGTH).trimEnd()}…`
}
