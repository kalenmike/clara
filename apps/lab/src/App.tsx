import { useCallback, useState } from 'react'
import { Badge } from './components/Badge'
import { Preview } from './components/Preview'
import { Runs } from './components/Runs'
import { Traffic } from './components/Traffic'
import { useLabStream } from './useLab'

type Tab = 'preview' | 'runs' | 'traffic'

export function App() {
  const stream = useLabStream()
  const [tab, setTab] = useState<Tab>('preview')
  const [startTarget, setStartTarget] = useState<string | undefined>()

  const useTarget = (target: string): void => {
    setStartTarget(target)
    setTab('runs')
  }
  const consumeTarget = useCallback(() => setStartTarget(undefined), [])

  if (!stream.snapshot) {
    return (
      <div className="app">
        <main className="loading">
          <h1>Clara Lab</h1>
          <p>{stream.error ?? 'Connecting to the lab server…'}</p>
        </main>
      </div>
    )
  }

  const snapshot = stream.snapshot

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <h1>Clara Lab</h1>
            <p className="muted">Pipeline preview and agent probe</p>
          </div>
        </div>
        <div className="app-status">
          <Badge tone={snapshot.connected ? 'ok' : 'bad'}>
            {snapshot.connected ? 'orchestrator connected' : 'orchestrator offline'}
          </Badge>
          <Badge tone={snapshot.heartbeat ? 'ok' : 'warn'}>
            {snapshot.heartbeat ? 'heartbeat on' : 'heartbeat paused'}
          </Badge>
          <span className="muted">{snapshot.orchestrator}</span>
          <span className="muted">{snapshot.workspace}</span>
        </div>
      </header>

      {stream.error ? <div className="banner warn">{stream.error}</div> : null}
      {snapshot.lastError ? <div className="banner warn">{snapshot.lastError}</div> : null}
      {!snapshot.tokenPresent ? (
        <div className="banner warn">
          No orchestrator token was found. Start the service with{' '}
          <code>pnpm clara orchestration start</code> or set <code>CLARA_ORCHESTRATION_TOKEN</code>.
        </div>
      ) : null}

      <nav className="tabs">
        <button
          type="button"
          className={`tab ${tab === 'preview' ? 'active' : ''}`}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
        <button
          type="button"
          className={`tab ${tab === 'runs' ? 'active' : ''}`}
          onClick={() => setTab('runs')}
        >
          Runs
          {snapshot.work.length ? <span className="tab-count">{snapshot.work.length}</span> : null}
        </button>
        <button
          type="button"
          className={`tab ${tab === 'traffic' ? 'active' : ''}`}
          onClick={() => setTab('traffic')}
        >
          Traffic
          {stream.calls.length ? <span className="tab-count">{stream.calls.length}</span> : null}
        </button>
      </nav>

      <main className="app-body">
        <div hidden={tab !== 'preview'}>
          <Preview stream={stream} onUseTarget={useTarget} />
        </div>
        {tab === 'runs' ? (
          <Runs
            stream={stream}
            {...(startTarget !== undefined ? { initialTarget: startTarget } : {})}
            onInitialTargetConsumed={consumeTarget}
          />
        ) : null}
        {tab === 'traffic' ? <Traffic stream={stream} /> : null}
      </main>
    </div>
  )
}
