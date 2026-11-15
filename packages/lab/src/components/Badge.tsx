import type { ReactNode } from 'react'
import { EmptyState } from '@clara/ui/patterns/empty-state'
import { KeyValue } from '@clara/ui/patterns/key-value'
import { StatusBadge, type StatusTone } from '@clara/ui/patterns/status-badge'

const TONES: Record<'ok' | 'bad' | 'live' | 'idle' | 'warn', StatusTone> = {
  ok: 'success',
  bad: 'danger',
  live: 'info',
  idle: 'neutral',
  warn: 'warning',
}

export function Badge({
  tone = 'idle',
  children,
}: {
  tone?: 'ok' | 'bad' | 'live' | 'idle' | 'warn'
  children: ReactNode
}) {
  return <StatusBadge tone={TONES[tone]}>{children}</StatusBadge>
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return <KeyValue label={label}>{value}</KeyValue>
}

export function Empty({ children }: { children: ReactNode }) {
  return <EmptyState>{children}</EmptyState>
}
