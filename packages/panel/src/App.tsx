import { useEffect, useMemo } from 'react'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { PanelSnapshot } from '@clara/shared-types'
import { collectSecrets } from './lib/peek.ts'
import { PeekProvider, usePeek } from './lib/peek-context.tsx'
import { useAgentSnapshot } from './lib/use-agent-snapshot.ts'
import { useSession, type SessionController } from './lib/use-session.ts'
import { usePanelTab } from './lib/use-panel-tab.ts'
import { useOnboarding } from './lib/use-onboarding.ts'
import { buildHealth, needsAttention, storageHealth, type HealthTone } from './lib/health.ts'
import type { PanelTab } from './lib/tabs.ts'
import { AuthScreen } from './components/auth-screen.tsx'
import { SetupModal } from './components/onboarding/setup-modal.tsx'
import { ActivityView } from './components/views/activity.tsx'
import { ClientsView } from './components/views/clients.tsx'
import { ConnectionsView } from './components/views/connections.tsx'
import { HarnessView } from './components/views/harness.tsx'
import { OverviewView } from './components/views/overview.tsx'
import { SessionsView } from './components/views/sessions.tsx'
import { SettingsView } from './components/views/settings.tsx'
import { TrafficView } from './components/views/traffic.tsx'
import { Rail, type RailBadge } from './components/shell/rail.tsx'
import { StatusBar } from './components/shell/status-bar.tsx'
import { TitleBar } from './components/shell/title-bar.tsx'

type SnapshotState = ReturnType<typeof useAgentSnapshot>

export function PanelApp({ initialPairingCode }: { initialPairingCode?: string } = {}) {
  const session = useSession()
  const authenticated = session.status?.authenticated === true
  const state = useAgentSnapshot({
    enabled: authenticated,
    onUnauthorized: session.invalidate,
  })
  const secrets = useMemo(() => collectSecrets(state.data), [state.data])

  if (session.loading && session.status === undefined) return <SessionLoading />
  if (!authenticated) return <AuthScreen session={session} />

  return (
    <PeekProvider secrets={secrets}>
      <Panel state={state} session={session} initialPairingCode={initialPairingCode} />
    </PeekProvider>
  )
}

function Panel({
  state,
  session,
  initialPairingCode,
}: {
  state: SnapshotState
  session: SessionController
  initialPairingCode?: string
}) {
  const { data, error, loading, refreshing, updatedAt, now, refresh } = state
  const { redact } = usePeek()
  const clock = now ?? updatedAt ?? 0
  const [tab, setTab] = usePanelTab()
  const badges = useMemo(() => (data ? buildBadges(data) : {}), [data])
  const onboarding = useOnboarding(data)

  useEffect(() => {
    if (initialPairingCode) setTab('harness')
  }, [initialPairingCode, setTab])

  return (
    <div className="panel-shell">
      <TitleBar
        data={data}
        error={error}
        updatedAt={updatedAt}
        now={clock}
        refreshing={refreshing}
        onRefresh={refresh}
        onLogout={() => void session.logout()}
      />

      <Rail active={tab} onSelect={setTab} badges={badges} />

      <main className="panel-workbench">
        {error && data ? (
          <div className="panel-banner warn" role="status">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Showing the last snapshot. {redact(error)}</span>
          </div>
        ) : null}

        {data?.controls.stopped ? (
          <div className="panel-banner warn" role="status">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              External connections are off. Open{' '}
              <button type="button" className="panel-link" onClick={() => setTab('overview')}>
                Overview
              </button>{' '}
              to go online.
            </span>
          </div>
        ) : null}

        {loading && !data ? (
          <LoadingState />
        ) : data ? (
          <>
            <div className="panel-view-slot" hidden={tab !== 'overview'}>
              <OverviewView snapshot={data} now={clock} onChanged={refresh} onSelect={setTab} />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'harness'}>
              <HarnessView
                snapshot={data}
                now={clock}
                onChanged={refresh}
                {...(initialPairingCode ? { initialPairingCode } : {})}
              />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'sessions'}>
              <SessionsView active={tab === 'sessions'} now={clock} />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'connections'}>
              <ConnectionsView snapshot={data} now={clock} onChanged={refresh} />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'clients'}>
              <ClientsView snapshot={data} now={clock} onChanged={refresh} />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'traffic'}>
              <TrafficView snapshot={data} now={clock} onChanged={refresh} />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'activity'}>
              <ActivityView snapshot={data} now={clock} />
            </div>
            <div className="panel-view-slot" hidden={tab !== 'settings'}>
              <SettingsView
                snapshot={data}
                now={clock}
                onChanged={refresh}
                setup={onboarding.setup}
                preferences={onboarding.preferences}
                onOpenSetup={onboarding.openSetup}
                onOpenReconfigure={onboarding.openReconfigure}
                onOpenGuide={onboarding.openGuide}
              />
            </div>
          </>
        ) : (
          <ErrorState error={error ? redact(error) : undefined} onRetry={refresh} />
        )}
      </main>

      <StatusBar data={data} onSelect={setTab} />

      {data ? (
        <SetupModal
          open={onboarding.open}
          mode={onboarding.mode}
          snapshot={data}
          setup={onboarding.setup}
          now={clock}
          onChanged={refresh}
          onPathChange={onboarding.setPath}
          onClose={onboarding.close}
          onFinish={onboarding.finish}
        />
      ) : null}
    </div>
  )
}

function buildBadges(snapshot: PanelSnapshot): Partial<Record<PanelTab, RailBadge>> {
  const health = buildHealth(snapshot)
  const [harness, local, relay, push] = health
  const traffic = snapshot.traffic.spike.length > 0
  const storage = storageHealth(snapshot.storage)
  const eventWarnings = snapshot.events.filter((event) => event.level !== 'info').length
  const activeClients = snapshot.clients.filter((client) => client.kind === 'device').length
  const attention = health.filter(needsAttention)

  const badges: Partial<Record<PanelTab, RailBadge>> = {}

  if (attention.length > 0) {
    badges.overview = {
      tone: attention.some((item) => item.tone === 'bad') ? 'bad' : 'warn',
    }
  }
  if (snapshot.harnesses.length > 0 || harness.tone === 'warn' || harness.tone === 'bad') {
    badges.harness = {
      ...(snapshot.harnesses.length > 0 ? { count: snapshot.harnesses.length } : {}),
      tone: railTone(harness.tone),
    }
  }

  const connectionTone = worstTone(local.tone, relay.tone, push.tone)
  if (connectionTone) badges.connections = { tone: connectionTone }

  if (activeClients > 0) badges.clients = { count: activeClients }
  if (traffic) badges.traffic = { tone: 'warn' }
  if (snapshot.events.length > 0 || eventWarnings > 0) {
    badges.activity = {
      ...(snapshot.events.length > 0 ? { count: snapshot.events.length } : {}),
      tone: eventWarnings > 0 || storage.tone === 'warn' ? 'warn' : undefined,
    }
  }

  return badges
}

function railTone(tone: HealthTone): RailBadge['tone'] {
  return tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : undefined
}

function worstTone(...tones: HealthTone[]): RailBadge['tone'] {
  if (tones.includes('bad')) return 'bad'
  if (tones.includes('warn')) return 'warn'
  return undefined
}

function SessionLoading() {
  return (
    <div className="panel-boot" aria-busy="true" aria-label="Checking panel session">
      <div className="panel-boot-mark" aria-hidden="true">
        C
      </div>
      <LoaderCircle className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <p>Clara hub panel</p>
    </div>
  )
}

function LoadingState() {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-busy="true"
      aria-label="Loading hub status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="panel-card h-40 animate-pulse" />
      ))}
    </div>
  )
}

function ErrorState({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="panel-card mx-auto mt-10 w-full max-w-lg p-6 text-center">
      <CircleAlert className="mx-auto size-6 text-red-500" aria-hidden="true" />
      <h2 className="mt-3 text-sm font-semibold">Could not read the hub status</h2>
      <p className="panel-muted mt-1 text-xs">{error ?? 'The panel API did not answer.'}</p>
      <button type="button" onClick={onRetry} className="panel-button mt-4">
        <LoaderCircle className="size-3.5" aria-hidden="true" />
        Try again
      </button>
      <p className="panel-muted mt-3 text-[11px]">
        Make sure the hub service is running and the panel is enabled on its loopback port.
      </p>
    </div>
  )
}
