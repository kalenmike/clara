import { useState, type FormEvent } from 'react'
import { CircleAlert, KeyRound, LoaderCircle, LogIn, ShieldCheck } from 'lucide-react'
import { authFormMode, canResetWithToken, showsUsernameField } from '../lib/auth-form.ts'
import type { SessionController } from '../lib/use-session.ts'

export function AuthScreen({ session }: { session: SessionController }) {
  const [resetOpen, setResetOpen] = useState(false)
  const mode = authFormMode(session.status, resetOpen)
  const setup = mode === 'setup'
  const reset = mode === 'reset'
  const credential = setup || reset
  const offerReset = canResetWithToken(session.status)
  const [username, setUsername] = useState(setup ? 'admin' : '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const openReset = () => {
    setResetOpen(true)
    setPassword('')
    setConfirm('')
    setToken('')
    setError(undefined)
  }

  const closeReset = () => {
    setResetOpen(false)
    setPassword('')
    setConfirm('')
    setToken('')
    setError(undefined)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    if (credential && password !== confirm) {
      setError('The passwords do not match')
      return
    }
    setPending(true)
    try {
      if (credential) await session.setup(token, setup ? username : '', password)
      else await session.login(username, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const heading = setup
    ? 'Set up the agent panel'
    : reset
      ? 'Reset the agent panel password'
      : 'Sign in to the agent panel'
  const description = setup
    ? 'Read the one-time setup token from the host, then choose the superadmin password.'
    : reset
      ? 'Enter the reset token from the host, then choose a new password for the superadmin account.'
      : 'This panel controls the home agent and its harness connections.'
  const submitLabel = pending
    ? 'Working…'
    : setup
      ? 'Set up panel'
      : reset
        ? 'Reset password'
        : 'Sign in'

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <main className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-6 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{heading}</h1>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{description}</p>
          </div>
        </div>

        <form className="space-y-3" onSubmit={(event) => void submit(event)}>
          {credential ? (
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {reset ? 'Reset token' : 'Setup token'}
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

          {showsUsernameField(mode) ? (
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
          ) : null}

          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {credential ? 'New password' : 'Password'}
            <input
              type="password"
              autoComplete={credential ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
              minLength={credential ? 12 : undefined}
              required
            />
          </label>

          {credential ? (
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

          {credential ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
              <KeyRound className="mr-1 inline size-3.5" aria-hidden="true" />
              The token is in <span className="font-mono">admin-setup.txt</span> in the agent config
              directory. Print it with{' '}
              <span className="font-mono">pnpm clara server setup-token</span>, or run{' '}
              <span className="font-mono">pnpm clara server admin reset</span> to issue a new one.
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
            ) : credential ? (
              <ShieldCheck className="size-4" aria-hidden="true" />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            {submitLabel}
          </button>

          {reset ? (
            <button
              type="button"
              onClick={closeReset}
              className="w-full text-center text-xs font-medium text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
            >
              Back to sign in
            </button>
          ) : offerReset ? (
            <button
              type="button"
              onClick={openReset}
              className="w-full text-center text-xs font-medium text-neutral-500 underline-offset-4 hover:underline dark:text-neutral-400"
            >
              Lost your password? Use a reset token.
            </button>
          ) : null}
        </form>
      </main>
    </div>
  )
}
