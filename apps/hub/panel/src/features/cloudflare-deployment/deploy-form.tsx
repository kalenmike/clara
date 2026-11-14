import { useState } from 'react'
import { Cloud } from 'lucide-react'
import type { PanelCloudflareAccount, PanelRelayDeployment } from '@clara/shared-types'
import { postPanel } from '../../lib/panel-api.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { Notice } from '../../components/primitives.tsx'
import type { CloudflareAccountsResponse, CloudflareDeployResponse } from './types.ts'

const TOKEN_URL =
  'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22account_settings%22%2C%22type%22%3A%22read%22%7D%5D&accountId=%2A&zoneId=all&name=Clara%20Relay'

export function DeployForm({
  cloudflare,
  onChanged,
  onClose,
}: {
  cloudflare: PanelRelayDeployment
  onChanged: () => void
  onClose: (warning?: string) => void
}) {
  const { redact } = usePeek()
  const [token, setToken] = useState('')
  const [useStored, setUseStored] = useState(cloudflare.tokenStored)
  const [remember, setRemember] = useState(!cloudflare.tokenStored)
  const [accounts, setAccounts] = useState<PanelCloudflareAccount[]>()
  const [accountId, setAccountId] = useState(cloudflare.accountId ?? '')
  const [scriptName, setScriptName] = useState(cloudflare.scriptName ?? 'clara-relay')
  const [replaceExisting, setReplaceExisting] = useState(cloudflare.managed)
  const [pending, setPending] = useState<'accounts' | 'deploy'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const needsToken = !useStored || !cloudflare.tokenStored

  const loadAccounts = async () => {
    if (needsToken && !token.trim()) {
      setError('Paste a Cloudflare API token first.')
      return
    }
    setPending('accounts')
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await postPanel<CloudflareAccountsResponse>(
        '/panel/api/v1/relay/cloudflare/accounts',
        needsToken ? { token: token.trim() } : {}
      )
      setAccounts(result.accounts)
      if (result.accounts.length === 1) setAccountId(result.accounts[0].id)
      if (result.accounts.length === 0) {
        setNotice('No accounts were returned. Enter the Cloudflare account ID manually.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const deploy = async () => {
    if (!accountId.trim()) {
      setError('Choose or enter a Cloudflare account ID.')
      return
    }
    if (needsToken && !token.trim()) {
      setError('Paste a Cloudflare API token first.')
      return
    }
    setPending('deploy')
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await postPanel<CloudflareDeployResponse>(
        '/panel/api/v1/relay/cloudflare/deploy',
        {
          ...(needsToken ? { token: token.trim(), rememberToken: remember } : {}),
          accountId: accountId.trim(),
          scriptName: scriptName.trim() || 'clara-relay',
          replaceExisting,
        }
      )
      setToken('')
      setAccounts(undefined)
      onChanged()
      onClose(result.warning)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      {needsToken ? (
        <>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium" htmlFor="cloudflare-token">
              Cloudflare API token
            </label>
            <input
              id="cloudflare-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a Workers-scoped API token"
              className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
          </div>
          <a
            href={TOKEN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-300"
          >
            Create a Cloudflare token
          </a>
          <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
            The token needs Workers Scripts: Edit. Account Settings: Read lets the panel list your
            accounts; you can also enter the account ID manually.
          </p>
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            Save this token on the hub, encrypted with the hub secret key
          </label>
        </>
      ) : (
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Using the saved Cloudflare token.{' '}
          <button
            type="button"
            onClick={() => setUseStored(false)}
            className="font-medium text-sky-700 hover:underline dark:text-sky-300"
          >
            Use a different token
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          onClick={() => void loadAccounts()}
          disabled={pending !== undefined}
          className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium disabled:opacity-60 dark:border-neutral-700"
        >
          {pending === 'accounts' ? 'Checking…' : accounts ? 'Refresh accounts' : 'Check account'}
        </button>
        {accounts && accounts.length > 1 ? (
          <label className="text-[11px]">
            Account
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="ml-1 rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Choose…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!accounts || accounts.length <= 1 ? (
          <label className="text-[11px]">
            Account ID
            <input
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="32-character account ID"
              className="ml-1 w-56 rounded-md border border-neutral-200 bg-white px-1.5 py-1 font-mono text-[11px] dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        ) : null}
      </div>

      <label className="block text-[11px]">
        Worker name
        <input
          value={scriptName}
          onChange={(event) => setScriptName(event.target.value)}
          className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(event) => setReplaceExisting(event.target.checked)}
        />
        Replace an existing Clara relay Worker with this name
      </label>

      {notice ? <Notice tone="warning">{redact(notice)}</Notice> : null}
      {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

      <button
        type="button"
        onClick={() => void deploy()}
        disabled={pending !== undefined}
        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Cloud className="size-3.5" aria-hidden="true" />
        {pending === 'deploy' ? 'Deploying…' : 'Deploy relay'}
      </button>
      <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
        Deployment usually takes under a minute. Existing devices must pair again after the relay
        changes.
      </p>
    </div>
  )
}
