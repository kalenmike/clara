import type { ReactNode } from 'react'
import { Badge as UiBadge } from '@clara/ui/components/badge'
import { Switch } from '@clara/ui/components/switch'
import { CopyButton as SharedCopyButton } from '@clara/ui/patterns/copy-button'
import { EmptyState as SharedEmptyState } from '@clara/ui/patterns/empty-state'
import { KeyValue as SharedKeyValue } from '@clara/ui/patterns/key-value'
import { Notice as SharedNotice } from '@clara/ui/patterns/notice'
import { SectionCard } from '@clara/ui/patterns/section-card'
import { StatusBadge, type StatusTone } from '@clara/ui/patterns/status-badge'
import { toggleTrackClasses } from '../lib/toggle-accent.ts'

export type Tone = StatusTone

export function CollapsibleCard({
  title,
  description,
  action,
  control,
  icon,
  expandable = true,
  defaultExpanded = false,
  notice,
  children,
}: {
  title: string
  description?: string
  action?: ReactNode
  control?: ReactNode
  icon?: ReactNode
  /** When false the header cannot be opened and the body is hidden. */
  expandable?: boolean
  /** Whether the body starts open. Only applies on first render. */
  defaultExpanded?: boolean
  notice?: ReactNode
  children: ReactNode
}) {
  return (
    <SectionCard
      as="section"
      title={
        <>
          {title}
          {action}
        </>
      }
      description={description}
      icon={icon}
      control={control}
      notice={notice}
      collapsible={expandable}
      defaultOpen={defaultExpanded}
    >
      {expandable ? children : null}
    </SectionCard>
  )
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="space-y-1">{children}</div>
}

export type ToggleState = 'off' | 'pending' | 'on'

export function Toggle({
  checked,
  onChange,
  label,
  state = checked ? 'on' : 'off',
  disabled = false,
  stopped = false,
  title,
}: {
  checked: boolean
  onChange: () => void
  label: string
  state?: ToggleState
  disabled?: boolean
  /** Redden an enabled switch while connections are off. */
  stopped?: boolean
  title?: string
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={toggleTrackClasses(state, stopped)}
    />
  )
}

export function Notice({
  children,
  tone = 'warning',
  title,
}: {
  children: ReactNode
  tone?: 'warning' | 'danger' | 'success' | 'info'
  title?: ReactNode
}) {
  return (
    <SharedNotice tone={tone} title={title}>
      {children}
    </SharedNotice>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>
}

export function KeyValue(props: {
  label: ReactNode
  children: ReactNode
  mono?: boolean
  title?: string
}) {
  return <SharedKeyValue {...props} />
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

export function SourceTag({ source }: { source: string }) {
  return (
    <UiBadge
      variant="outline"
      className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase"
    >
      {source}
    </UiBadge>
  )
}

export function CopyButton({
  value,
  label = 'Copy',
  onError,
  variant = 'compact',
}: {
  value: string
  label?: string
  onError?: (message: string) => void
  variant?: 'compact' | 'block'
}) {
  return <SharedCopyButton value={value} label={label} onError={onError} variant={variant} />
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <SharedEmptyState>{children}</SharedEmptyState>
}
