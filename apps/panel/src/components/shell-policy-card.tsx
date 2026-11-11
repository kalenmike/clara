import { useEffect, useId, useState } from 'react'
import { ShieldOff, TerminalSquare } from 'lucide-react'
import type { PanelShellControl } from '@clara/shared-types'
import { postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import {
  Badge,
  CardBody,
  CollapsibleCard,
  Notice,
  Toggle,
  type ToggleState,
} from './primitives.tsx'

const PRESET = 'git log'

/**
 * The panel is the only place the shell policy can change. It stays editable
 * while the agent is stopped: the policy has no effect until connections
 * return, and admins often want it set before starting the agent.
 *
 * Turning the toggle on prepares a draft; only Apply saves it. Turning it off
 * saves `off` immediately, because the card collapses and no action row is
 * left to submit.
 */
export function ShellPolicyCard({
  shell,
  onChanged,
  defaultExpanded = false,
}: {
  shell: PanelShellControl
  onChanged: () => void
  defaultExpanded?: boolean
}) {
  const ids = useId()
  const savedOn = shell.mode === 'allowlist'
  const savedCommands = shell.commands.join('\n')
  const [open, setOpen] = useState(savedOn)
  const [commands, setCommands] = useState(savedCommands)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState<'apply' | 'off'>()
  const [error, setError] = useState<string>()
  const { redact } = usePeek()

  useEffect(() => {
    if (editing) return
    setOpen(shell.mode === 'allowlist')
    setCommands(shell.commands.join('\n'))
  }, [editing, shell.mode, shell.commands])

  // The saved policy catches up with the draft after Apply or a disable. Stop
  // treating the draft as unsaved at that point.
  useEffect(() => {
    if (!editing) return
    const mode = open ? 'allowlist' : 'off'
    if (shell.mode === mode && shell.commands.join('\n') === commands) setEditing(false)
  }, [editing, open, commands, shell.mode, shell.commands])

  const dirty =
    editing && ((open ? 'allowlist' : 'off') !== shell.mode || commands !== savedCommands)
  const filters = lines(commands)
  const emptyFilters = filters.length === 0
  const hasGitHistory = filters.includes(PRESET)
  const busy = pending !== undefined

  const toggle = () => {
    if (busy) return
    if (open) {
      void disable()
      return
    }
    setOpen(true)
    setEditing(true)
    setError(undefined)
  }

  const disable = async () => {
    if (
      dirty &&
      !window.confirm('Discard the unsaved command filters and block every shell command?')
    ) {
      return
    }
    if (!savedOn) {
      setOpen(false)
      setEditing(false)
      setCommands(savedCommands)
      setError(undefined)
      return
    }
    setPending('off')
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/shell', { mode: 'off', commands: shell.commands })
      setOpen(false)
      setEditing(true)
      setCommands(savedCommands)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const apply = async () => {
    const next = lines(commands)
    setPending('apply')
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/shell', { mode: 'allowlist', commands: next })
      setCommands(next.join('\n'))
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const discard = () => {
    setOpen(savedOn)
    setCommands(savedCommands)
    setEditing(false)
    setError(undefined)
  }

  const toggleGitHistory = () => {
    const next = lines(commands)
    const index = next.indexOf(PRESET)
    if (index >= 0) next.splice(index, 1)
    else next.push(PRESET)
    setCommands(next.join('\n'))
    setEditing(true)
    setError(undefined)
  }

  const toggleState: ToggleState = busy ? 'pending' : open ? (savedOn ? 'on' : 'pending') : 'off'

  const badge =
    pending === 'off' ? (
      <Badge tone="warning">Pending</Badge>
    ) : savedOn ? (
      <Badge tone={shell.commands.length === 0 ? 'warning' : 'info'}>
        {shell.commands.length === 0 ? 'All allowed' : `Filtered · ${shell.commands.length}`}
      </Badge>
    ) : open ? (
      <Badge tone="warning">Pending</Badge>
    ) : (
      <Badge tone="neutral">Blocked</Badge>
    )

  return (
    <CollapsibleCard
      title="Shell commands"
      description="Command requests the web client may send through this agent to OpenCode"
      icon={<TerminalSquare className="size-4" aria-hidden="true" />}
      action={badge}
      defaultExpanded={defaultExpanded}
      expandable={open}
      control={
        <Toggle
          checked={open}
          onChange={toggle}
          label={`Shell commands: ${open ? 'on' : 'off'}`}
          state={toggleState}
          disabled={busy}
        />
      }
    >
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            {savedOn
              ? shell.blocked === 0
                ? 'No requests refused since the agent started.'
                : `${shell.blocked} request${shell.blocked === 1 ? '' : 's'} refused since the agent started.`
              : 'Applying enables shell commands for the web client.'}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-2.5 py-2 dark:border-neutral-800">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Allow Git history
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Adds the <code className="font-mono">{PRESET}</code> filter, which covers commit
              history.
            </p>
          </div>
          <Toggle
            checked={hasGitHistory}
            onChange={toggleGitHistory}
            label={`Allow Git history: ${hasGitHistory ? 'on' : 'off'}`}
            state={hasGitHistory ? 'on' : 'off'}
            disabled={busy}
          />
        </div>

        <div className="space-y-1.5 pt-1">
          <label
            htmlFor={`${ids}-commands`}
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            Filter commands
          </label>
          <textarea
            id={`${ids}-commands`}
            value={commands}
            onChange={(event) => {
              setCommands(event.target.value)
              setEditing(true)
              setError(undefined)
            }}
            disabled={busy}
            rows={4}
            spellCheck={false}
            placeholder={PRESET}
            className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-2.5 py-2 font-mono text-xs text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-neutral-600 dark:disabled:bg-neutral-900"
          />
          {emptyFilters ? <Notice>No filters set. Every shell command is allowed.</Notice> : null}
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            One literal command prefix per line. Shell syntax is refused rather than parsed, and
            interpreters such as <code className="font-mono">sh</code> or{' '}
            <code className="font-mono">env</code> cannot be filtered. Leave the list empty to allow
            every command. <code className="font-mono">{PRESET}</code> also allows the formatted
            history command, for example{' '}
            <code className="break-all font-mono">
              git log --since=2026-01-01T12:00:00Z --until=2026-01-01T12:30:00Z -n 10
              --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e
            </code>
            .
          </p>
        </div>

        <p className="flex items-start gap-1.5 rounded-md bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-400">
          <ShieldOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            This is a guardrail, not a sandbox. It governs command requests relayed by this agent,
            not what OpenCode or a modified client can do with the rest of the API.
          </span>
        </p>

        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          {dirty ? (
            <button
              type="button"
              onClick={discard}
              disabled={busy}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || !dirty}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {pending === 'apply' ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </CardBody>
    </CollapsibleCard>
  )
}

function lines(value: string): string[] {
  const normalized = value
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  return Array.from(new Set(normalized))
}
