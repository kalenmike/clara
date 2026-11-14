import { useState } from 'react'
import { Cloud, RefreshCw, Trash2 } from 'lucide-react'
import { formatRelative, formatTimestamp } from '../../lib/format.ts'
import { postPanel } from '../../lib/panel-api.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { CopyButton, KeyValue, Notice } from '../../components/primitives.tsx'
import { DeployForm } from './deploy-form.tsx'
import type { CloudflareRelaySlotProps } from './types.ts'

export default function CloudflareRelaySlot({ relay, now, onChanged }: CloudflareRelaySlotProps) {
  const cloudflare = relay.cloudflare
  const { redact } = usePeek()
  const [open, setOpen] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [success, setSuccess] = useState<string>()

  if (!cloudflare?.available) return null

  const forget = async () => {
    setForgetting(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/relay/cloudflare/forget', {})
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setForgetting(false)
    }
  }

  const closeForm = (warning?: string) => {
    setOpen(false)
    if (warning) {
      setNotice(warning)
      setSuccess(undefined)
    } else {
      setNotice(undefined)
      setSuccess('Relay deployed. Existing devices must pair again to use it.')
    }
  }

  const canDeploy = !cloudflare.envManaged

  return (
    <div
      className="space-y-2 border-t border-neutral-100 pt-2 dark:border-neutral-800/60"
      data-clara-cloudflare-deployment="v1"
    >
      {cloudflare.managed ? (
        <>
          <KeyValue label="Cloudflare account">
            {cloudflare.accountName ?? cloudflare.accountId ?? 'Unknown'}
          </KeyValue>
          <KeyValue label="Worker" mono>
            {cloudflare.scriptName ?? '—'}
          </KeyValue>
          {cloudflare.customDomain ? (
            <KeyValue label="Custom domain" mono>
              <span className="inline-flex flex-wrap items-center justify-end gap-2">
                <span>{cloudflare.customDomain.hostname}</span>
                <span
                  className={
                    cloudflare.customDomain.ready
                      ? 'rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                  }
                >
                  {cloudflare.customDomain.ready ? 'Ready' : 'Certificate pending'}
                </span>
              </span>
            </KeyValue>
          ) : null}
          {cloudflare.disableWorkersDev ? <KeyValue label="workers.dev">Disabled</KeyValue> : null}
          <KeyValue label="Relay host" mono>
            <span className="inline-flex flex-wrap items-center justify-end gap-2">
              <span>{cloudflare.hostname ?? '—'}</span>
              {cloudflare.hostname ? (
                <CopyButton value={`wss://${cloudflare.hostname}`} label="Copy relay URL" />
              ) : null}
            </span>
          </KeyValue>
          <KeyValue label="Deployed" title={formatTimestamp(cloudflare.deployedAt)}>
            {cloudflare.deployedAt ? formatRelative(cloudflare.deployedAt, now) : '—'}
          </KeyValue>
          <KeyValue label="Health">
            {cloudflare.reachable === false ? 'Deployed, not answering yet' : 'Reachable'}
          </KeyValue>
          <KeyValue label="API token">{cloudflare.tokenStored ? 'Saved' : 'Not saved'}</KeyValue>
        </>
      ) : (
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Deploy the relay Worker and its Durable Object to your own Cloudflare account. Clara
          stores the relay tokens on this hub; Cloudflare only forwards encrypted frames.
        </p>
      )}

      {cloudflare.envManaged ? (
        <Notice tone="warning">
          Relay settings come from the environment. Remove{' '}
          <span className="font-mono">CLARA_RELAY_URL</span>,{' '}
          <span className="font-mono">CLARA_RELAY_ROOM</span>, and the relay tokens before deploying
          from the panel.
        </Notice>
      ) : null}
      {cloudflare.managed && !cloudflare.connected && relay.configured ? (
        <Notice tone="warning">
          The relay URL changed outside this deployment. Deploy again to reconnect it.
        </Notice>
      ) : null}
      {cloudflare.customDomain && !cloudflare.customDomain.ready ? (
        <Notice tone="warning">
          The custom hostname is not answering yet, so the relay stays on the workers.dev hostname.
          Cloudflare can take a few minutes to issue the certificate; deploy again once it is
          active.
        </Notice>
      ) : null}
      {notice ? <Notice tone="warning">{redact(notice)}</Notice> : null}
      {success ? (
        <p className="rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          {redact(success)}
        </p>
      ) : null}
      {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {canDeploy ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            disabled={forgetting}
            className={
              cloudflare.managed
                ? 'inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900'
                : 'inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-60'
            }
          >
            {cloudflare.managed ? (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            ) : (
              <Cloud className="size-3.5" aria-hidden="true" />
            )}
            {open ? 'Close' : cloudflare.managed ? 'Deploy again' : 'Deploy relay to Cloudflare'}
          </button>
        ) : null}
        {cloudflare.tokenStored ? (
          <button
            type="button"
            onClick={() => void forget()}
            disabled={forgetting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {forgetting ? 'Forgetting…' : 'Forget token'}
          </button>
        ) : null}
      </div>

      {open ? (
        <DeployForm cloudflare={cloudflare} onChanged={onChanged} onClose={closeForm} />
      ) : null}
    </div>
  )
}
