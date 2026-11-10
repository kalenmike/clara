import { useState, type FormEvent } from 'react'
import { CircleAlert, KeyRound, LoaderCircle, LogIn, ShieldCheck } from 'lucide-react'
import type { SessionController } from '../lib/use-session.ts'

export function AuthScreen({ session }: { session: SessionController }) {
  const setup = session.status?.authenticated === false && session.status.setupRequired
  const [username, setUsername] = useState(setup ? 'admin' : '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    if (setup && password !== confirm) {
      setError('The passwords do not match')
      return
    }
    setPending(true)
    try {
      if (setup) await session.setup(token, username, password)
      else await session.login(username, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <main className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {setup ? 'Set up the agent panel' : 'Sign in to the agent panel'}
            </h1>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {setup
                ? 'Read the one-time setup token from the host, then choose the superadmin password.'
                : 'This panel controls the home agent and its harness connections.'}
            </p>
          </div>
        </div>

        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          {setup ? (
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Setup token
              <input
                type="password"
                autoComplete="one-time-code"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
                required
              />
            </label>
          ) : null}

          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
              required
            />
          </label>

          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {setup ? 'New password' : 'Password'}
            <input
              type="password"
              autoComplete={setup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
              minLength={setup ? 12 : undefined}
              required
            />
          </label>

          {setup ? (
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
                minLength={12}
                required
              />
            </label>
          ) : null}

          {setup ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              <KeyRound className="mr-1 inline size-3.5" aria-hidden="true" />
              The token is in <span className="font-mono">admin-setup.txt</span> in the agent config
              directory. Print it with{' '}
              <span className="font-mono">pnpm clara server setup-token</span>, or run{' '}
              <span className="font-mono">pnpm clara server admin reset</span> if it is missing. Add{' '}
              <span className="font-mono">--docker</span> for the container.
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : setup ? (
              <ShieldCheck className="size-4" aria-hidden="true" />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            {pending ? 'Working…' : setup ? 'Set up panel' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  )
}
