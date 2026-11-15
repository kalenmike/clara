import { useEffect, useId, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Input } from '@clara/ui/components/input'
import type { PanelRelayTransport } from '@clara/shared-types'
import { RELAY_TARGET_LOCK_REASON, usePanelCapabilities } from '../lib/capabilities-context.ts'
import { formatTimestamp, sourceLabel } from '../lib/format.ts'
import { deletePanel, postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { ConfirmDialog } from './confirm-dialog.tsx'
import { Notice, SourceTag } from './primitives.tsx'

const TOKEN_FORMAT_ERROR =
  'The relay token must be at least 32 characters with no spaces or commas. Use the generated value or `openssl rand -base64 32`.'

function invalidToken(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.length < 32 || trimmed.length > 512 || /[\s,]/.test(trimmed)
}

export function RelayEditor({
  relay,
  onChanged,
}: {
  relay: PanelRelayTransport
  onChanged: () => void
}) {
  const { redact } = usePeek()
  const { allowRelayTargetEdit } = usePanelCapabilities()
  const targetLocked = !allowRelayTargetEdit
  const tokenErrorId = useId()
  const [url, setUrl] = useState(relay.url ?? '')
  const [agentToken, setAgentToken] = useState('')
  const [pending, setPending] = useState<'save' | 'clear' | 'room'>()
  const [confirmAction, setConfirmAction] = useState<'clear' | 'room' | null>(null)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    setUrl(relay.url ?? '')
  }, [relay.url])

  const urlFromEnv = relay.urlSource === 'env'
  const agentFromEnv = relay.agentTokenSource === 'env'
  const agentTokenInvalid = Boolean(agentToken.trim()) && invalidToken(agentToken)
  const tokenError = agentTokenInvalid ? TOKEN_FORMAT_ERROR : undefined
  const hasPanelValues =
    relay.urlSource === 'file' ||
    relay.roomSource === 'file' ||
    relay.roomSource === 'generated' ||
    relay.agentTokenSource === 'file'
  const hasAgentToken = agentFromEnv || relay.agentTokenConfigured || Boolean(agentToken.trim())
  const replacedAt =
    relay.replacedAt !== undefined
      ? formatTimestamp(new Date(relay.replacedAt).toISOString())
      : undefined
  const canSave =
    Boolean((relay.url ?? '').trim() || url.trim()) &&
    hasAgentToken &&
    !tokenError &&
    (!urlFromEnv || Boolean(agentToken.trim()))

  const save = async () => {
    setPending('save')
    setError(undefined)
    setNotice(undefined)
    try {
      const body: { url?: string; agentToken?: string } = {}
      if (!urlFromEnv) {
        if (!url.trim()) throw new Error('Enter a relay URL')
        body.url = url.trim()
      }
      if (agentToken.trim()) body.agentToken = agentToken.trim()
      if (Object.keys(body).length === 0) {
        throw new Error('Nothing to save')
      }
      await postPanel('/panel/api/v1/relay', body)
      setAgentToken('')
      setNotice('Relay saved. Devices may need to pair again if the room or hub token changed.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
    }
  }

  const clear = async () => {
    setPending('clear')
    setError(undefined)
    setNotice(undefined)
    try {
      await deletePanel('/panel/api/v1/relay')
      setNotice('Panel relay values cleared.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
      setConfirmAction(null)
    }
  }

  const regenerate = async () => {
    setPending('room')
    setError(undefined)
    setNotice(undefined)
    try {
      await postPanel('/panel/api/v1/relay/room', {})
      setNotice('Relay room regenerated. Pair every device again.')
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(undefined)
      setConfirmAction(null)
    }
  }

  return (
    <div className="space-y-2 border-t border-border pt-2">
      {targetLocked ? <Notice>{RELAY_TARGET_LOCK_REASON}</Notice> : null}

      {replacedAt ? (
        <Notice>
          Another hub connected to this room at {replacedAt}. Check for a second hub using the same
          token, or rotate the hub token. See the troubleshooting guide, &ldquo;The relay keeps
          saying another hub connected.&rdquo;
        </Notice>
      ) : null}

      {relay.envManaged ? (
        <Notice>
          Environment values take precedence. Fields marked <SourceTag source="environment" /> are
          read-only until the matching variable is removed and the hub service restarts.
        </Notice>
      ) : null}

      <label className="block text-[11px]">
        <span className="flex items-center justify-between gap-2">
          Relay URL
          {relay.urlSource ? <SourceTag source={sourceLabel(relay.urlSource)} /> : null}
        </span>
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={urlFromEnv || targetLocked || pending !== undefined}
          spellCheck={false}
          placeholder="wss://relay.example"
          className="mt-1 font-mono text-xs"
        />
      </label>

      <div className="flex items-end justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-2">
          <span>Room</span>
          <span className="truncate font-mono text-[11px] text-foreground">
            {relay.room ?? 'Generated on first save'}
          </span>
          {relay.roomSource ? <SourceTag source={sourceLabel(relay.roomSource)} /> : null}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => setConfirmAction('room')}
          disabled={!relay.roomRegeneratable || targetLocked || pending !== undefined}
        >
          <RefreshCw className="size-3" aria-hidden="true" />
          {pending === 'room' ? 'Regenerating…' : 'Regenerate room'}
        </Button>
      </div>

      <label className="block text-[11px]">
        <span className="flex items-center justify-between gap-2">
          Hub token
          {relay.agentTokenSource ? (
            <SourceTag source={relay.agentTokenSource === 'env' ? 'environment' : 'encrypted'} />
          ) : null}
        </span>
        <Input
          type="password"
          value={agentToken}
          onChange={(event) => setAgentToken(event.target.value)}
          disabled={agentFromEnv || targetLocked || pending !== undefined}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={agentTokenInvalid || undefined}
          aria-describedby={agentTokenInvalid ? tokenErrorId : undefined}
          placeholder={
            agentFromEnv
              ? 'Provided by the environment'
              : relay.agentTokenConfigured
                ? 'Saved — leave blank to keep'
                : 'Required'
          }
          className="mt-1 font-mono text-xs"
        />
      </label>

      <p className="text-[10px] text-muted-foreground">
        The token is encrypted on this hub and never shown again. It must match the Worker secret.
        Changing the room or hub token requires every device to pair again.
      </p>

      {tokenError ? (
        <Notice tone="danger">
          <span id={tokenErrorId}>{redact(tokenError)}</span>
        </Notice>
      ) : null}
      {notice ? <Notice tone="success">{redact(notice)}</Notice> : null}
      {error ? <Notice tone="danger">{redact(error)}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!canSave || targetLocked || pending !== undefined}
        >
          {pending === 'save' ? 'Saving…' : 'Save and connect'}
        </Button>
        {hasPanelValues ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setConfirmAction('clear')}
            disabled={targetLocked || pending !== undefined}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            {pending === 'clear' ? 'Clearing…' : 'Clear panel relay'}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmAction != null}
        title={confirmAction === 'room' ? 'Regenerate relay room?' : 'Clear panel relay?'}
        description={
          confirmAction === 'room'
            ? 'Replace the relay room with a new random value? Every paired device must pair again.'
            : 'Remove the relay values saved in the panel? Environment values still apply, and devices may need to pair again.'
        }
        confirmLabel={confirmAction === 'room' ? 'Regenerate room' : 'Clear panel relay'}
        pendingLabel={confirmAction === 'room' ? 'Regenerating…' : 'Clearing…'}
        pending={
          confirmAction === 'room'
            ? pending === 'room'
            : confirmAction === 'clear'
              ? pending === 'clear'
              : false
        }
        danger
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null)
        }}
        onConfirm={() => {
          if (confirmAction === 'room') void regenerate()
          else if (confirmAction === 'clear') void clear()
        }}
      />
    </div>
  )
}
