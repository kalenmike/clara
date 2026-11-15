import { useState, type FormEvent } from 'react'
import { LoaderCircle, LogIn, ShieldCheck } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Card } from '@clara/ui/components/card'
import { Checkbox } from '@clara/ui/components/checkbox'
import { Input } from '@clara/ui/components/input'
import {
  authFormMode,
  canResetWithToken,
  setupNeedsToken,
  showsUsernameField,
} from '../lib/auth-form.ts'
import { getPanelUsername, rememberPanelUsername } from '../lib/panel-session.ts'
import type { SessionController } from '../lib/use-session.ts'
import { Notice } from './primitives.tsx'

export function AuthScreen({ session }: { session: SessionController }) {
  const [resetOpen, setResetOpen] = useState(false)
  const mode = authFormMode(session.status, resetOpen)
  const setup = mode === 'setup'
  const reset = mode === 'reset'
  const credential = setup || reset
  const tokenRequired = setupNeedsToken(session.status)
  const needsTokenField = reset || (setup && tokenRequired)
  const offerReset = canResetWithToken(session.status)
  const [username, setUsername] = useState(() => (setup ? 'admin' : (getPanelUsername() ?? '')))
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(true)
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
      if (credential) await session.setup(token, setup ? username : '', password, remember)
      else await session.login(username, password, remember)
      if (showsUsernameField(mode)) rememberPanelUsername(username)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const heading = setup
    ? 'Create the hub owner account'
    : reset
      ? 'Reset the hub panel password'
      : 'Sign in to the hub panel'
  const description = setup
    ? tokenRequired
      ? 'Paste the host setup token, then choose the owner account for this hub.'
      : 'Choose the owner account for this hub. No other hub service starts until this account exists.'
    : reset
      ? 'Enter the reset token from the host, then choose a new password for the superadmin account.'
      : 'This panel controls the hub service and its harness connections.'
  const submitLabel = pending
    ? 'Working…'
    : setup
      ? 'Create owner account'
      : reset
        ? 'Reset password'
        : 'Sign in'

  return (
    <div className="panel-auth flex min-h-screen items-center justify-center bg-background px-4">
      <Card asChild>
        <main className="w-full max-w-md p-6">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{heading}</h1>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            </div>
          </div>

          <form className="space-y-3" onSubmit={(event) => void submit(event)}>
            {needsTokenField ? (
              <label className="block text-xs font-medium text-foreground">
                {reset ? 'Reset token' : 'Setup token'}
                <Input
                  type="password"
                  name="token"
                  autoComplete="one-time-code"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  className="mt-1 font-mono"
                  required
                />
              </label>
            ) : null}

            {showsUsernameField(mode) ? (
              <label className="block text-xs font-medium text-foreground">
                Username
                <Input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="mt-1"
                  required
                />
              </label>
            ) : null}

            <label className="block text-xs font-medium text-foreground">
              {credential ? 'New password' : 'Password'}
              <Input
                type="password"
                name="password"
                autoComplete={credential ? 'new-password' : 'current-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1"
                minLength={credential ? 12 : undefined}
                required
              />
            </label>

            {credential ? (
              <label className="block text-xs font-medium text-foreground">
                Confirm password
                <Input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  className="mt-1"
                  minLength={12}
                  required
                />
              </label>
            ) : null}

            <label className="block text-xs font-medium text-foreground">
              <span className="flex items-start gap-2">
                <Checkbox
                  name="remember"
                  checked={remember}
                  onCheckedChange={(value) => setRemember(value === true)}
                  className="mt-0.5"
                />
                <span>
                  Keep me signed in on this device
                  <span className="mt-0.5 block font-normal text-muted-foreground">
                    Stops asking for your password until you sign out.
                  </span>
                </span>
              </span>
            </label>

            {needsTokenField ? (
              <Notice tone="warning">
                {reset ? (
                  <>
                    The reset token is written by the host command{' '}
                    <span className="font-mono">clara-server admin reset</span>.
                  </>
                ) : (
                  <>
                    This hub was started with a host setup token. Use the value supplied by the host
                    or the environment.
                  </>
                )}
              </Notice>
            ) : setup ? (
              <Notice tone="info">
                This setup screen is available on the hub machine only. The hub starts after this
                account is created.
              </Notice>
            ) : null}

            {error ? <Notice tone="danger">{error}</Notice> : null}

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              ) : credential ? (
                <ShieldCheck className="size-4" aria-hidden="true" />
              ) : (
                <LogIn className="size-4" aria-hidden="true" />
              )}
              {submitLabel}
            </Button>

            {reset ? (
              <Button type="button" variant="link" onClick={closeReset} className="w-full text-xs">
                Back to sign in
              </Button>
            ) : offerReset ? (
              <Button type="button" variant="link" onClick={openReset} className="w-full text-xs">
                Lost your password? Use a reset token.
              </Button>
            ) : null}
          </form>
        </main>
      </Card>
    </div>
  )
}
