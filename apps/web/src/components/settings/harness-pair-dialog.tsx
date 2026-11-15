import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ClaraHarnessPairingResponse } from '@clara/api-contract'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateHarnessPairing } from '@/features/harness/use-harness-pairing'
import { useHarnesses } from '@/features/projects/use-projects'
import {
  adapterHostAvailable,
  adapterHostJob,
  cancelAdapterHostInstall,
  listAdapterHostTargets,
  startAdapterHostInstall,
  subscribeAdapterHostLinks,
  takeAdapterHostLink,
  type AdapterHostLink,
  type AdapterHostMethod,
  type AdapterHostTargets,
} from '@/lib/desktop-adapter-host'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { useConnection } from '@/providers/connection-provider'
import {
  buildAdapterInstallLink,
  decodeHarnessPairingCode,
  type AdapterInstallJob,
} from '@clara/shared-types'

const KINDS = [
  { kind: 'opencode', label: 'OpenCode' },
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'pi', label: 'Pi' },
] as const

const MANUAL = '__manual__'

export function HarnessPairDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const desktop = adapterHostAvailable()
  const create = useCreateHarnessPairing()
  const harnesses = useHarnesses()
  const queryClient = useQueryClient()
  const { client } = useConnection()
  const [kind, setKind] = useState<string>(KINDS[0].kind)
  const [method, setMethod] = useState<AdapterHostMethod>('local')
  const [opencodeUrl, setOpencodeUrl] = useState('')
  const [offer, setOffer] = useState<ClaraHarnessPairingResponse>()
  const [targets, setTargets] = useState<AdapterHostTargets>()
  const [host, setHost] = useState('')
  const [hostname, setHostname] = useState('')
  const [user, setUser] = useState('')
  const [port, setPort] = useState('')
  const [container, setContainer] = useState('')
  const [job, setJob] = useState<AdapterInstallJob>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!open) return
    setOffer(undefined)
    setJob(undefined)
    setError(undefined)
    setHost('')
    setHostname('')
    setUser('')
    setPort('')
    setContainer('')
    if (!desktop) return

    const openLinked = async (link: AdapterHostLink) => {
      try {
        const payload = decodeHarnessPairingCode(link.code)
        if (!payload) throw new Error('The link did not contain a valid pairing code.')
        const linkedKind = link.kind ?? payload.kind
        const { manifest } = await client!.harness.manifest(linkedKind)
        setKind(linkedKind)
        setOffer({
          pairing: {
            id: payload.enrollId,
            kind: linkedKind,
            label: linkedKind,
            code: link.code,
            transport: payload.room === 'local' ? 'local' : 'relay',
            wsUrl: payload.wsUrl,
            room: payload.room,
            fingerprint: payload.fingerprint,
            expiresAt: new Date(payload.expiresAt).toISOString(),
            createdAt: new Date().toISOString(),
          },
          manifest,
          deepLink: buildAdapterInstallLink(link.code, linkedKind),
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    void listAdapterHostTargets()
      .then(setTargets)
      .catch(() => setTargets(undefined))
    void takeAdapterHostLink().then((link) => {
      if (link) void openLinked(link)
    })
    return subscribeAdapterHostLinks((link) => void openLinked(link))
    // The dialog body is reset per open; the mutation is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, open])

  const connection = useMemo(() => {
    if (!offer) return undefined
    return harnesses.data?.find((item) => item.kind === offer.pairing.kind && item.online)
  }, [harnesses.data, offer])

  useEffect(() => {
    if (!offer || connection) return
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.harnesses })
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [connection, offer, queryClient])

  useEffect(() => {
    if (!job || job.state !== 'running') return
    const timer = window.setInterval(() => {
      void adapterHostJob(job.id)
        .then(setJob)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [job])

  const begin = () => {
    setError(undefined)
    create.mutate(
      {
        kind,
        ...(desktop ? { method } : {}),
      },
      {
        onSuccess: setOffer,
        onError: (cause) => setError(cause.message),
      }
    )
  }

  const install = () => {
    if (!offer?.manifest) return
    setError(undefined)
    void startAdapterHostInstall({
      kind: offer.pairing.kind,
      method,
      pairingCode: offer.pairing.code,
      manifest: offer.manifest,
      ...(method === 'ssh'
        ? {
            host:
              host === MANUAL
                ? {
                    hostname: hostname.trim(),
                    ...(user.trim() ? { user: user.trim() } : {}),
                    ...(port.trim() ? { port: Number(port) } : {}),
                  }
                : { alias: host },
          }
        : {}),
      ...(method === 'docker' ? { container } : {}),
      ...(opencodeUrl.trim() ? { opencodeUrl: opencodeUrl.trim() } : {}),
    })
      .then(setJob)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pair a harness</DialogTitle>
          <DialogDescription>
            The hub issues a one-time code. Run the command on the machine that hosts the harness,
            or install it here with Clara Desktop.
          </DialogDescription>
        </DialogHeader>

        {!offer ? (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Harness</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((item) => (
                    <SelectItem key={item.kind} value={item.kind}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {desktop ? (
              <div className="grid gap-2">
                <Label>Where it runs</Label>
                <Select
                  value={method}
                  onValueChange={(value) => setMethod(value as AdapterHostMethod)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">This computer</SelectItem>
                    <SelectItem value="ssh">SSH host or VPS</SelectItem>
                    <SelectItem value="docker">Docker container</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {desktop && method === 'ssh' ? (
              <SshTarget
                targets={targets}
                host={host}
                setHost={setHost}
                hostname={hostname}
                setHostname={setHostname}
                user={user}
                setUser={setUser}
                port={port}
                setPort={setPort}
              />
            ) : null}

            {desktop && method === 'docker' ? (
              <div className="grid gap-2">
                <Label>Container</Label>
                <Select value={container} onValueChange={setContainer}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a running container" />
                  </SelectTrigger>
                  <SelectContent>
                    {(targets?.docker.containers ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.name}>
                        {item.name} — {item.image}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {kind === 'opencode' ? (
              <div className="grid gap-2">
                <Label>
                  OpenCode URL <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  value={opencodeUrl}
                  onChange={(event) => setOpencodeUrl(event.target.value)}
                  placeholder="http://127.0.0.1:4096"
                  spellCheck={false}
                />
              </div>
            ) : null}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : (
          <OfferPanel
            offer={offer}
            connection={connection}
            job={job}
            desktop={desktop}
            method={method}
            onCopy={copy}
            onInstall={install}
            onCancel={() => void cancelAdapterHostInstall(job!.id)}
          />
        )}

        <DialogFooter>
          {!offer ? (
            <Button onClick={begin} disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {create.isPending ? 'Preparing…' : 'Create code'}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OfferPanel({
  offer,
  connection,
  job,
  desktop,
  method,
  onCopy,
  onInstall,
  onCancel,
}: {
  offer: ClaraHarnessPairingResponse
  connection: { online: boolean; label: string } | undefined
  job: AdapterInstallJob | undefined
  desktop: boolean
  method: AdapterHostMethod
  onCopy: (value: string, label: string) => Promise<void>
  onInstall: () => void
  onCancel: () => void
}) {
  const connected = Boolean(connection)
  return (
    <div className="space-y-3">
      <div className="grid gap-1">
        <Label>Pairing code</Label>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted p-2 font-mono text-xs">
            {offer.pairing.code}
          </code>
          <Button
            variant="outline"
            size="icon"
            onClick={() => void onCopy(offer.pairing.code, 'Code')}
          >
            <Copy className="size-4" />
          </Button>
        </div>
      </div>

      {offer.command ? (
        <div className="grid gap-1">
          <Label>Install command</Label>
          <div className="flex items-start gap-2">
            <pre className="min-w-0 flex-1 overflow-x-auto rounded bg-muted p-2 text-xs">
              {offer.command}
            </pre>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void onCopy(offer.command ?? '', 'Command')}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <a
        href={offer.deepLink}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        <ExternalLink className="size-3.5" />
        Open in Clara Desktop
      </a>

      {desktop && offer.manifest ? (
        <Button
          onClick={onInstall}
          disabled={job?.state === 'running' || (method === 'ssh' && !offer.pairing.code)}
        >
          {job?.state === 'running' && <Loader2 className="size-4 animate-spin" />}
          {job?.state === 'running' ? 'Installing…' : 'Install on this computer'}
        </Button>
      ) : null}

      {job ? (
        <div className="space-y-2">
          <pre className="max-h-40 overflow-auto rounded bg-neutral-950 p-2 text-[11px] whitespace-pre-wrap text-neutral-100">
            {job.lines.join('\n')}
          </pre>
          {job.state === 'running' ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          {job.error ? <p className="text-xs text-destructive">{job.error}</p> : null}
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {connected ? (
          <>
            <Check className="size-3.5 text-emerald-600" />
            Connected · {connection?.label}
          </>
        ) : (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Waiting for the adapter to connect…
          </>
        )}
      </p>
    </div>
  )
}

function SshTarget({
  targets,
  host,
  setHost,
  hostname,
  setHostname,
  user,
  setUser,
  port,
  setPort,
}: {
  targets: AdapterHostTargets | undefined
  host: string
  setHost: (value: string) => void
  hostname: string
  setHostname: (value: string) => void
  user: string
  setUser: (value: string) => void
  port: string
  setPort: (value: string) => void
}) {
  const hosts = targets?.ssh.hosts ?? []
  return (
    <div className="space-y-2">
      <div className="grid gap-2">
        <Label>Host</Label>
        <Select value={host} onValueChange={setHost}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a host from ~/.ssh/config" />
          </SelectTrigger>
          <SelectContent>
            {hosts.map((item) => (
              <SelectItem key={item.alias} value={item.alias}>
                {item.alias} — {item.user ? `${item.user}@` : ''}
                {item.hostname}
              </SelectItem>
            ))}
            <SelectItem value={MANUAL}>Enter manually…</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {host === MANUAL ? (
        <div className="grid grid-cols-3 gap-2">
          <Input
            className="col-span-1"
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="server.example"
          />
          <Input
            value={user}
            onChange={(event) => setUser(event.target.value)}
            placeholder="user"
          />
          <Input
            value={port}
            onChange={(event) => setPort(event.target.value)}
            placeholder="22"
            inputMode="numeric"
          />
        </div>
      ) : null}
    </div>
  )
}
