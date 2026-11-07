import { json } from '../lib/format'

export function JsonView({
  value,
  maxHeight,
  empty = '—',
}: {
  value: unknown
  maxHeight?: number | string
  empty?: string
}) {
  if (value === undefined || value === null || value === '') {
    return <div className="muted">{empty}</div>
  }
  return (
    <pre className="json" style={maxHeight ? { maxHeight } : undefined}>
      {json(value)}
    </pre>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: unknown; label?: string }) {
  return (
    <button
      type="button"
      className="button ghost small"
      onClick={() => {
        void navigator.clipboard?.writeText(json(value)).catch(() => {})
      }}
    >
      {label}
    </button>
  )
}
