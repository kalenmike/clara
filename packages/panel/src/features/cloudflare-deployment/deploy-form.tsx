import { useState } from 'react'
import { Cloud } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Checkbox } from '@clara/ui/components/checkbox'
import { Input } from '@clara/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import type {
  PanelCloudflareAccount,
  PanelCloudflareZone,
  PanelRelayDeployment,
} from '@clara/shared-types'
import { postPanel } from '../../lib/panel-api.ts'
import { usePeek } from '../../lib/peek-context.tsx'
import { Notice } from '../../components/primitives.tsx'
import type {
  CloudflareAccountsResponse,
  CloudflareDeployResponse,
  CloudflareZonesResponse,
} from './types.ts'

const TOKEN_PERMISSIONS = [
  { key: 'workers_scripts', type: 'edit' },
  { key: 'account_settings', type: 'read' },
  { key: 'zone', type: 'read' },
  { key: 'workers_routes', type: 'edit' },
]
const TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
  JSON.stringify(TOKEN_PERMISSIONS)
)}&accountId=%2A&zoneId=all&name=Clara%20Relay`

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
  const [zones, setZones] = useState<PanelCloudflareZone[]>()
  const [zoneId, setZoneId] = useState(cloudflare.customDomain?.zoneId ?? '')
  const [hostname, setHostname] = useState(cloudflare.customDomain?.hostname ?? '')
  const [disableWorkersDev, setDisableWorkersDev] = useState(cloudflare.disableWorkersDev ?? false)
  const [scriptName, setScriptName] = useState(cloudflare.scriptName ?? 'clara-relay')
  const [replaceExisting, setReplaceExisting] = useState(cloudflare.managed)
  const [previewUrls, setPreviewUrls] = useState(cloudflare.previewUrls ?? false)
  const [pending, setPending] = useState<'accounts' | 'zones' | 'deploy'>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  const needsToken = !useStored || !cloudflare.tokenStored
  const customHostname = hostname.trim()

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
      if (result.accounts.length === 1) {
        setAccountId(result.accounts[0].id)
        void loadZones(result.accounts[0].id)
      }
      if (result.accounts.length === 0) {
        setNotice('No accounts were returned. Enter the Cloudflare account ID manually.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const loadZones = async (selectedAccountId = accountId) => {
    const target = selectedAccountId.trim()
    if (!target) {
      setError('Choose or enter a Cloudflare account ID first.')
      return
    }
    if (needsToken && !token.trim()) {
      setError('Paste a Cloudflare API token first.')
      return
    }
    setPending('zones')
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await postPanel<CloudflareZonesResponse>(
        '/panel/api/v1/relay/cloudflare/zones',
        {
          ...(needsToken ? { token: token.trim() } : {}),
          accountId: target,
        }
      )
      setZones(result.zones)
      setZoneId((current) => {
        const preferred = cloudflare.customDomain?.zoneId || current
        if (preferred && result.zones.some((zone) => zone.id === preferred)) return preferred
        return result.zones.length === 1 ? result.zones[0].id : ''
      })
      if (result.zones.length === 0) {
        setNotice(
          'No zones were returned. Add the domain to this Cloudflare account, or keep the workers.dev hostname.'
        )
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
          previewUrls,
          ...(customHostname
            ? {
                customDomain: {
                  hostname: customHostname,
                  ...(zoneId ? { zoneId } : {}),
                },
              }
            : {}),
          ...(customHostname && disableWorkersDev ? { disableWorkersDev: true } : {}),
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
    <div className="space-y-2 rounded-lg border border-border p-3">
      {needsToken ? (
        <>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium" htmlFor="cloudflare-token">
              Cloudflare API token
            </label>
            <Input
              id="cloudflare-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a Workers-scoped API token"
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
          <p className="text-[10px] text-muted-foreground">
            The token needs Workers Scripts: Edit, Zone: Read, and Zone: Workers Routes: Edit.
            Account Settings: Read lets the panel list your accounts; you can also enter the account
            ID manually.
          </p>
          <label className="flex items-center gap-2 text-[11px]">
            <Checkbox checked={remember} onCheckedChange={(value) => setRemember(value === true)} />
            Save this token on the hub, encrypted with the hub secret key
          </label>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Using the saved Cloudflare token.{' '}
          <Button
            type="button"
            variant="link"
            onClick={() => setUseStored(false)}
            className="h-auto p-0 text-xs"
          >
            Use a different token
          </Button>
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => void loadAccounts()}
          disabled={pending !== undefined}
        >
          {pending === 'accounts' ? 'Checking…' : accounts ? 'Refresh accounts' : 'Check account'}
        </Button>
        {accounts && accounts.length > 1 ? (
          <label className="text-[11px]">
            Account
            <Select
              value={accountId || undefined}
              onValueChange={(next) => {
                setAccountId(next)
                setZones(undefined)
                setZoneId('')
                if (next) void loadZones(next)
              }}
            >
              <SelectTrigger className="ml-1">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        ) : null}
        {!accounts || accounts.length <= 1 ? (
          <label className="text-[11px]">
            Account ID
            <Input
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              placeholder="32-character account ID"
              className="ml-1 w-56 font-mono text-xs"
            />
          </label>
        ) : null}
      </div>

      <label className="block text-[11px]">
        Worker name
        <Input
          value={scriptName}
          onChange={(event) => setScriptName(event.target.value)}
          className="mt-1 font-mono text-xs"
        />
      </label>

      <div className="space-y-2 rounded-md border border-border p-2">
        <div className="flex flex-wrap items-end gap-2">
          <p className="text-[11px] font-medium">Custom domain (optional)</p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => void loadZones()}
            disabled={pending !== undefined}
          >
            {pending === 'zones' ? 'Loading zones…' : zones ? 'Refresh zones' : 'Load zones'}
          </Button>
          {zones && zones.length > 0 ? (
            <label className="text-[11px]">
              Zone
              <Select value={zoneId || undefined} onValueChange={setZoneId}>
                <SelectTrigger className="ml-1">
                  <SelectValue placeholder="Choose…" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((zone) => (
                    <SelectItem key={zone.id} value={zone.id}>
                      {zone.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
        </div>
        <Input
          value={hostname}
          onChange={(event) => setHostname(event.target.value)}
          placeholder="relay.example.com"
          spellCheck={false}
          autoComplete="off"
          aria-label="Custom domain hostname"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-muted-foreground">
          Enter a bare hostname in one of this account&apos;s zones. Cloudflare issues the
          certificate after the deploy; the relay stays on workers.dev until the custom host
          answers.
        </p>
      </div>

      <label className="flex items-center gap-2 text-[11px]">
        <Checkbox
          checked={replaceExisting}
          onCheckedChange={(value) => setReplaceExisting(value === true)}
        />
        Replace an existing Clara relay Worker with this name
      </label>

      <details className="rounded-md border border-border">
        <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium text-foreground marker:hidden [&::-webkit-details-marker]:hidden">
          Advanced
        </summary>
        <div className="space-y-1 border-t border-border px-2 py-2">
          <label className="flex items-start gap-2 text-[11px]">
            <Checkbox
              checked={previewUrls}
              onCheckedChange={(value) => setPreviewUrls(value === true)}
              aria-describedby="cloudflare-preview-urls-help"
              className="mt-0.5"
            />
            Enable preview and version URLs for this Worker
          </label>
          <p id="cloudflare-preview-urls-help" className="text-[10px] text-muted-foreground">
            Preview URLs only add extra hostnames that bypass host-scoped WAF and rate-limit rules.
          </p>
          <label
            className={
              customHostname
                ? 'flex items-start gap-2 text-[11px]'
                : 'flex items-start gap-2 text-[11px] opacity-60'
            }
          >
            <Checkbox
              checked={disableWorkersDev && Boolean(customHostname)}
              disabled={!customHostname}
              onCheckedChange={(value) => setDisableWorkersDev(value === true)}
              aria-describedby="cloudflare-disable-workers-dev-help"
              className="mt-0.5"
            />
            Disable the workers.dev hostname
          </label>
          <p id="cloudflare-disable-workers-dev-help" className="text-[10px] text-muted-foreground">
            Available after you enter a custom hostname. This changes the relay URL to the custom
            domain, and existing devices must pair again. The host is only turned off after the
            custom hostname answers its health check.
          </p>
        </div>
      </details>

      {notice ? <Notice tone="warning">{redact(notice)}</Notice> : null}
      {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

      <Button type="button" onClick={() => void deploy()} disabled={pending !== undefined}>
        <Cloud className="size-3.5" aria-hidden="true" />
        {pending === 'deploy' ? 'Deploying…' : 'Deploy relay'}
      </Button>
      <p className="text-[10px] text-muted-foreground">
        Deployment usually takes under a minute; a new custom domain can take a few minutes for its
        certificate. Existing devices must pair again after the relay changes.
      </p>
    </div>
  )
}
