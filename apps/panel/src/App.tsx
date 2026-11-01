import { CircleAlert, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { formatRelative, formatTimestamp } from './lib/format.ts'
import { useAgentSnapshot } from './lib/use-agent-snapshot.ts'
import { ClientsTable } from './components/clients-table.tsx'
import { EventsCard } from './components/events-list.tsx'
import {
  AgentCard,
  ConfigCard,
  LocalCard,
  OpenCodeCard,
  PushCard,
  RelayCard,
} from './components/overview-cards.tsx'
import { Badge } from './components/primitives.tsx'
import { StorageCard } from './components/storage-list.tsx'

export function App() {
  const { data, error, loading, refreshing, updatedAt, now, refresh } = useAgentSnapshot()
  const clock = now ?? updatedAt ?? 0

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="relative flex size-10 items-center justify-center rounded-xl bg-neutral-950 text-sm font-semibold text-white shadow-sm dark:bg-white dark:text-neutral-950">
              C
              <span
                className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-neutral-50 bg-emerald-500 dark:border-neutral-950"
                aria-hidden="true"
              />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Clara agent panel</h1>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Read-only view of the home agent, its transports, and its storage.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={error && data ? 'warning' : data ? 'success' : error ? 'danger' : 'neutral'}
            >
              {error && data ? 'Stale' : data ? 'Connected' : error ? 'Offline' : 'Connecting'}
            </Badge>
            {updatedAt ? (
              <span
                className="text-[11px] text-neutral-500 dark:text-neutral-400"
                title={formatTimestamp(new Date(updatedAt).toISOString())}
              >
                Updated {formatRelative(new Date(updatedAt).toISOString(), clock)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </header>

        {error && data ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Showing the last snapshot. {error}</span>
          </div>
        ) : null}

        {loading && !data ? (
          <LoadingState />
        ) : data ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <AgentCard agent={data.agent} now={clock} />
              <OpenCodeCard opencode={data.opencode} now={clock} />
              <LocalCard
                local={data.local}
                sessions={data.clients.filter((client) => client.transport === 'local').length}
              />
              <RelayCard relay={data.relay} now={clock} />
              <PushCard push={data.push} />
              <ConfigCard config={data.config} />
            </div>

            <ClientsTable clients={data.clients} now={clock} />

            <div className="grid gap-4 xl:grid-cols-2">
              <StorageCard storage={data.storage} now={clock} />
              <EventsCard events={data.events} now={clock} />
            </div>
          </div>
        ) : (
          <ErrorState error={error} onRetry={refresh} />
        )}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Loopback only · read-only API · secrets are never shown
          </span>
          <span>
            API v{data?.apiVersion ?? 1} · generated{' '}
            {data ? formatRelative(data.generatedAt, clock) : '—'}
          </span>
        </footer>
      </main>
    </div>
  )
}

function LoadingState() {
  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      aria-busy="true"
      aria-label="Loading agent status"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-64 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
        />
      ))}
    </div>
  )
}

function ErrorState({ error, onRetry }: { error?: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900 dark:bg-neutral-900">
      <CircleAlert className="mx-auto size-6 text-red-500" aria-hidden="true" />
      <h2 className="mt-3 text-sm font-semibold">Could not read the agent status</h2>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        {error ?? 'The panel API did not answer.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
      >
        <LoaderCircle className="size-3.5" aria-hidden="true" />
        Try again
      </button>
      <p className="mt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
        Make sure the agent is running and the panel is enabled on its loopback port.
      </p>
    </div>
  )
}
