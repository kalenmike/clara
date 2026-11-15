import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type { PanelConfigInfo, PanelControls, PanelInstallInfo } from '@clara/shared-types'
import { sourceLabel } from '../lib/format.ts'
import { fetchInstallInfo } from '../lib/install.ts'
import { postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import { ConfigEditorRow } from './overview-cards.tsx'
import { Badge, CardBody, CollapsibleCard, Notice, Toggle } from './primitives.tsx'

export function AdapterRegistryCard({
  config,
  controls,
  onChanged,
}: {
  config: PanelConfigInfo
  controls: PanelControls
  onChanged: () => void
}) {
  const { redact } = usePeek()
  const [info, setInfo] = useState<PanelInstallInfo>()
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const enabled = controls.install.enabled

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setInfo(await fetchInstallInfo())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async () => {
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/install/settings', { enabled: !enabled })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const entries = info?.registry.entries ?? []

  return (
    <CollapsibleCard
      title="Adapter setup"
      description="Registry manifests and install commands"
      icon={<Download className="size-4" aria-hidden="true" />}
      defaultExpanded
      action={
        <Badge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Setup on' : 'Setup off'}</Badge>
      }
      control={
        <Toggle
          checked={enabled}
          onChange={() => void toggle()}
          label="Allow adapter setup"
          state={pending ? 'pending' : enabled ? 'on' : 'off'}
          disabled={pending}
        />
      }
    >
      <CardBody>
        {error ? <Notice tone="danger">{redact(error)}</Notice> : null}
        <p className="panel-muted text-[11px]">
          The hub reads the manifest and builds the install command. It never downloads, bundles, or
          runs the adapter; the person runs the command on the harness machine.
        </p>
        <ConfigEditorRow
          id="config-adapter-registry"
          label="Registry URL"
          field="adapterRegistryUrl"
          value={config.adapterRegistryUrl.value}
          source={config.adapterRegistryUrl.source}
          sourceText={sourceLabel(config.adapterRegistryUrl.source)}
          hint="Manifests live at <registry>/<harness>/manifest.json."
          savedHint="Saved in server.json."
          defaultHint="Using https://clara.kalenmichael.com/adapters."
          envHint="Set by CLARA_ADAPTER_REGISTRY_URL. Remove it and restart the hub service to edit here."
          placeholder="https://clara.kalenmichael.com/adapters"
          mono
          onChanged={onChanged}
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Check registry
          </button>
          {info ? (
            <span className="panel-muted text-[10px]">
              {info.available
                ? 'Install actions are available.'
                : (info.reason ?? 'Install actions are off.')}
            </span>
          ) : null}
        </div>
        <div className="space-y-2 pt-1">
          {entries.map((entry) => (
            <div
              key={entry.kind}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2 text-[11px]"
            >
              <span className="font-medium">{entry.kind}</span>
              {entry.ok && entry.manifest ? (
                <>
                  <Badge tone="info">v{entry.manifest.version}</Badge>
                  {entry.installedVersion ? (
                    <Badge
                      tone={
                        entry.installedVersion === entry.manifest.version ? 'success' : 'warning'
                      }
                    >
                      installed v{entry.installedVersion}
                    </Badge>
                  ) : null}
                  <span className="panel-muted">
                    {Object.keys(entry.manifest.artifacts).length} platform build
                    {Object.keys(entry.manifest.artifacts).length === 1 ? '' : 's'}
                  </span>
                </>
              ) : (
                <Badge tone="danger">{entry.error ? 'Unavailable' : 'Not checked'}</Badge>
              )}
              <span className="panel-muted min-w-0 flex-1 truncate text-right font-mono text-[10px]">
                {entry.manifestUrl}
              </span>
              {entry.manifest &&
              entry.installedVersion &&
              entry.installedVersion !== entry.manifest.version ? (
                <span className="w-full text-amber-700 dark:text-amber-300">
                  The connected adapter reports v{entry.installedVersion}. Reinstall from this
                  registry to move it to v{entry.manifest.version}.
                </span>
              ) : null}
              {entry.error ? (
                <span className="w-full text-red-700 dark:text-red-300">{redact(entry.error)}</span>
              ) : null}
            </div>
          ))}
        </div>
      </CardBody>
    </CollapsibleCard>
  )
}
