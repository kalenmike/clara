import { useEffect, useId, useState, type ReactNode } from 'react'
import { Check, ChevronDown, CircleAlert, Copy } from 'lucide-react'
import { toggleTrackClasses } from '../lib/toggle-accent.ts'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_CLASSES: Record<Tone, string> = {
  neutral:
    'border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  info: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300',
}

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
}

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
  const bodyId = useId()
  const [expanded, setExpanded] = useState(defaultExpanded)

  useEffect(() => {
    if (!expandable) setExpanded(false)
  }, [expandable])

  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div
          className={`relative flex min-w-0 flex-1 items-start gap-2 ${expandable ? 'cursor-pointer' : ''}`}
        >
          {expandable ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-controls={bodyId}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
              className="absolute inset-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
            />
          ) : null}
          <span className="mt-0.5 shrink-0">{icon}</span>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {title}
              {action}
              {expandable ? (
                <ChevronDown
                  className={`size-3.5 shrink-0 text-neutral-400 transition ${expanded ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              ) : null}
            </h2>
            {description ? (
              <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
            ) : null}
          </div>
        </div>
        {control ? <div className="relative z-10 shrink-0">{control}</div> : null}
      </div>
      {notice}
      {expandable && expanded ? <div id={bodyId}>{children}</div> : null}
    </section>
  )
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="space-y-1 px-4 py-3">{children}</div>
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
  /** Redden an enabled switch while the agent is stopped. */
  stopped?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${toggleTrackClasses(state, stopped)}`}
    >
      <span
        className={`inline-block size-4 rounded-full bg-white shadow transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export function Notice({
  children,
  tone = 'warning',
}: {
  children: ReactNode
  tone?: 'warning' | 'danger'
}) {
  const classes =
    tone === 'danger'
      ? 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
      : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
  return (
    <p className={`flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs ${classes}`}>
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}
    >
      <span className={`size-1.5 rounded-full ${DOT_CLASSES[tone]}`} aria-hidden="true" />
      {children}
    </span>
  )
}

export function KeyValue({
  label,
  children,
  mono = false,
  title,
}: {
  label: string
  children: ReactNode
  mono?: boolean
  title?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 py-1.5 text-sm last:border-0 dark:border-neutral-800/60">
      <span className="shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
      <span
        className={`min-w-0 break-words text-right text-neutral-900 dark:text-neutral-100 ${mono ? 'font-mono text-xs' : ''}`}
        title={title}
      >
        {children}
      </span>
    </div>
  )
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-neutral-500 dark:text-neutral-400">{children}</span>
}

export function SourceTag({ source }: { source: string }) {
  return (
    <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
      {source}
    </span>
  )
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
    } catch {
      setState('error')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-1.5 py-1 text-[11px] text-neutral-600 transition hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      aria-label={label}
    >
      {state === 'copied' ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <Copy className="size-3" aria-hidden="true" />
      )}
      {state === 'copied' ? 'Copied' : state === 'error' ? 'Failed' : label}
    </button>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-4 text-center text-xs text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
      {children}
    </p>
  )
}
