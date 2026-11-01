import { useEffect, useId, useState } from 'react'
import { CircleAlert, ShieldOff, TerminalSquare } from 'lucide-react'
import type { PanelShellControl, ShellPolicyMode } from '@clara/shared-types'
import { postPanel } from '../lib/panel-api.ts'
import { Badge, Card, CardBody, CardHeader } from './primitives.tsx'

const PRESET = 'git log'

/**
 * The panel is the only place the shell policy can change. It stays editable
 * while the agent is stopped: the policy has no effect until connections
 * return, and admins often want it set before starting the agent.
 */
export function ShellPolicyCard({
  shell,
  onChanged,
}: {
  shell: PanelShellControl
  onChanged: () => void
}) {
  const ids = useId()
  const [mode, setMode] = useState<ShellPolicyMode>(shell.mode)
  const [commands, setCommands] = useState(shell.commands.join('\n'))
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (editing) return
    setMode(shell.mode)
    setCommands(shell.commands.join('\n'))
  }, [editing, shell.mode, shell.commands])

  const touch = () => {
    setEditing(true)
    setError(undefined)
  }

  const save = async () => {
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/shell', { mode, commands: lines(commands) })
      setEditing(false)
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const applyPreset = () => {
    const next = lines(commands)
    if (!next.includes(PRESET)) next.push(PRESET)
    setCommands(next.join('\n'))
    setMode('allowlist')
    touch()
  }

  const dirty = editing && (mode !== shell.mode || commands !== shell.commands.join('\n'))

  return (
    <Card>
      <CardHeader
        title="Shell commands"
        description="Command requests the web client may send through this agent to OpenCode"
        icon={<TerminalSquare className="size-4" aria-hidden="true" />}
        action={
          shell.mode === 'off' ? (
            <Badge tone="neutral">Blocked</Badge>
          ) : (
            <Badge tone="warning">Allowlist · {shell.commands.length}</Badge>
          )
        }
      />
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {shell.mode === 'off' ? 'All command requests are refused' : 'Selected commands only'}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {shell.blocked === 0
                ? 'No requests refused since the agent started.'
                : `${shell.blocked} request${shell.blocked === 1 ? '' : 's'} refused since the agent started.`}
            </p>
          </div>
          <button
            type="button"
            onClick={applyPreset}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            Allow Git history
          </button>
        </div>

        <fieldset className="space-y-2 pt-3">
          <legend className="sr-only">Shell command policy</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${ids}-mode`}
              value="off"
              checked={mode === 'off'}
              onChange={() => {
                setMode('off')
                touch()
              }}
              className="mt-1 size-3.5 accent-neutral-900 dark:accent-neutral-100"
            />
            <span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                Block every command
              </span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                The web client cannot create shell or PTY jobs. Existing saved commands are kept.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`${ids}-mode`}
              value="allowlist"
              checked={mode === 'allowlist'}
              onChange={() => {
                setMode('allowlist')
                touch()
              }}
              className="mt-1 size-3.5 accent-neutral-900 dark:accent-neutral-100"
            />
            <span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                Allow selected commands
              </span>
              <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                One literal command prefix per line. Shell syntax is refused rather than parsed.
              </span>
            </span>
          </label>
        </fieldset>

        <div className="space-y-1.5 pt-1">
          <label
            htmlFor={`${ids}-commands`}
            className="block text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            Allowed commands
          </label>
          <textarea
            id={`${ids}-commands`}
            value={commands}
            onChange={(event) => {
              setCommands(event.target.value)
              touch()
            }}
            disabled={mode === 'off'}
            rows={4}
            spellCheck={false}
            placeholder={PRESET}
            className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-2.5 py-2 font-mono text-xs text-neutral-900 shadow-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100 dark:focus:border-neutral-600 dark:disabled:bg-neutral-900"
          />
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            <code className="font-mono">{PRESET}</code> also allows the formatted history command,
            for example{' '}
            <code className="break-all font-mono">
              git log -n 10 --format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e
            </code>
            . Interpreters such as <code className="font-mono">sh</code> or{' '}
            <code className="font-mono">env</code> cannot be allowed.
          </p>
        </div>

        <p className="flex items-start gap-1.5 rounded-md bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-600 dark:bg-neutral-900/60 dark:text-neutral-400">
          <ShieldOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            This is a guardrail, not a sandbox. It governs command requests relayed by this agent,
            not what OpenCode or a modified client can do with the rest of the API.
          </span>
        </p>

        {error ? (
          <p className="flex items-start gap-1.5 rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:bg-red-950/50 dark:text-red-300">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          {dirty ? (
            <button
              type="button"
              onClick={() => {
                setMode(shell.mode)
                setCommands(shell.commands.join('\n'))
                setEditing(false)
                setError(undefined)
              }}
              disabled={pending}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void save()}
            disabled={pending || !dirty}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {pending ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
}
