import { json } from '../lib/format'
import { Button } from '@clara/ui/components/button'

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
    <Button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(json(value)).catch(() => {})
      }}
      variant="ghost"
      size="xs"
    >
      {label}
    </Button>
  )
}
