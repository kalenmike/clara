import type { ReactNode } from 'react'

export function Badge({
  tone = 'idle',
  children,
}: {
  tone?: 'ok' | 'bad' | 'live' | 'idle' | 'warn'
  children: ReactNode
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
