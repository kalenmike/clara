export function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
      continue
    }
    search.append(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
