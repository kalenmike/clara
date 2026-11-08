import { useCallback, useEffect, useRef, useState } from 'react'
import { preflight, registerAdapter, reconnect } from './api'
import { Badge } from './components/Badge'
import { Preview } from './components/Preview'
import { Runs } from './components/Runs'
import { Setup } from './components/Setup'
import { Traffic } from './components/Traffic'
import { friendlyError } from './lib/errors'
import { loadSettings, saveSettings, type LabSettings, type LabTab } from './lib/settings'
import type { PreflightResult } from './types'
import { useLabStream } from './useLab'

export function App() {
  const stream = useLabStream()
  const [settings, setSettings] = useState<LabSettings>(() => loadSettings())
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(true)
  const setupRef = useRef<HTMLDivElement>(null)
  const autoCollapsed = useRef(false)

  const update = useCallback((patch: Partial<LabSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveSettings(next)
      return next
    })
    if (patch.hostWorkspace !== undefined || patch.target !== undefined) {
      setPreflightResult(null)
      setPreflightError(null)
    }
  }, [])

  useEffect(() => {
    if (settings.hostWorkspace || !stream.snapshot?.workspace) return
    update({ hostWorkspace: stream.snapshot.workspace })
  }, [settings.hostWorkspace, stream.snapshot?.workspace, update])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!preflightResult || autoCollapsed.current) return
    const ok =
      preflightResult.host.ok &&
      preflightResult.runtime.ok &&
      (!preflightResult.adapter.required || preflightResult.adapter.ok)
    if (ok) {
      autoCollapsed.current = true
      setSetupOpen(false)
    }
  }, [preflightResult])

  useEffect(() => {
    if (preflightError) setSetupOpen(true)
  }, [preflightError])

  const hostWorkspace = settings.hostWorkspace.trim() || stream.snapshot?.workspace || ''
  const runtimeWorkspace = stream.snapshot?.orchestratorWorkspace || ''

  const runPreflight = useCallback(async (): Promise<void> => {
    if (!hostWorkspace) return
    setPreflightLoading(true)
    setPreflightError(null)
    try {
      const result = await preflight({
        hostWorkspace,
        ...(settings.target ? { target: settings.target } : {}),
      })
      setPreflightResult(result)
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPreflightLoading(false)
    }
  }, [hostWorkspace, settings.target])

  useEffect(() => {
    if (!stream.snapshot || !hostWorkspace) return
    const timer = window.setTimeout(() => void runPreflight(), 800)
    return () => window.clearTimeout(timer)
  }, [stream.snapshot?.connected, hostWorkspace, runtimeWorkspace, settings.target, runPreflight])

  const setTab = (tab: LabTab): void => {
    update({ tab })
  }

  const enableAdapter = async (): Promise<void> => {
    if (!runtimeWorkspace) {
      setPreflightError('The orchestrator has not reported its workspace yet.')
      return
    }
    try {
      await registerAdapter(runtimeWorkspace)
      setNotice('Registered the clara-lab adapter for this workspace.')
      await runPreflight()
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const reconnectNow = async (): Promise<void> => {
    try {
      await reconnect()
      setNotice('Reconnected to the orchestrator.')
      await runPreflight()
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const goToSetup = (): void => {
    setSetupOpen(true)
    setupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
  const runtimeError = snapshot.lastError ? friendlyError(snapshot.lastError, 'runtime') : null

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand">
          <span className="brand-mark">C</span>
          <div>
            <h1>Clara Lab</h1>
            <p className="muted">Pick a pipeline, preview it, then act as the AI step by step.</p>
          </div>
        </div>
        <div className="app-status">
          <Badge tone={snapshot.connected ? 'ok' : 'bad'}>
            {snapshot.connected ? 'connected' : 'offline'}
          </Badge>
          <Badge tone={snapshot.tokenPresent ? 'ok' : 'warn'}>
            {snapshot.tokenPresent ? 'token ready' : 'no token'}
          </Badge>
          <button type="button" className="button ghost small" onClick={goToSetup}>
            Setup
          </button>
        </div>
      </header>

      <div ref={setupRef}>
        <Setup
          snapshot={snapshot}
          hostWorkspace={settings.hostWorkspace}
          onHostWorkspace={(value) => update({ hostWorkspace: value })}
          preflight={preflightResult}
          loading={preflightLoading}
          error={preflightError}
          open={setupOpen}
          onToggle={() => setSetupOpen((value) => !value)}
          onCheck={() => void runPreflight()}
          onReconnect={() => void reconnectNow()}
          onEnableAdapter={() => void enableAdapter()}
        />
      </div>

      {stream.error ? <div className="banner warn">{stream.error}</div> : null}
      {runtimeError ? (
        <div className="banner warn">
          <strong>{runtimeError.title}.</strong> {runtimeError.hint ?? runtimeError.detail}
        </div>
      ) : null}
      {!snapshot.tokenPresent ? (
        <div className="banner warn">
          No orchestrator token was found. Start the service or set{' '}
          <code>CLARA_ORCHESTRATION_TOKEN</code>, then restart the lab.
        </div>
      ) : null}
      {notice ? <div className="banner ok">{notice}</div> : null}

      <nav className="tabs">
        <button
          type="button"
          className={`tab ${settings.tab === 'pipeline' ? 'active' : ''}`}
          onClick={() => setTab('pipeline')}
        >
          Pipeline
        </button>
        <button
          type="button"
          className={`tab ${settings.tab === 'run' ? 'active' : ''}`}
          onClick={() => setTab('run')}
        >
          Run
          {snapshot.work.length ? <span className="tab-count">{snapshot.work.length}</span> : null}
        </button>
        <button
          type="button"
          className={`tab ${settings.tab === 'traffic' ? 'active' : ''}`}
          onClick={() => setTab('traffic')}
        >
          Traffic
          {stream.calls.length ? <span className="tab-count">{stream.calls.length}</span> : null}
        </button>
      </nav>

      <main className="app-body">
        <div hidden={settings.tab !== 'pipeline'}>
          <Preview
            stream={stream}
            hostWorkspace={hostWorkspace}
            target={settings.target}
            onTargetChange={(target) => update({ target })}
            active={settings.tab === 'pipeline'}
            onRun={() => setTab('run')}
            onEditSetup={goToSetup}
          />
        </div>
        <div hidden={settings.tab !== 'run'}>
          <Runs
            stream={stream}
            hostWorkspace={hostWorkspace}
            runtimeWorkspace={runtimeWorkspace}
            target={settings.target}
            pauseAfterStep={settings.pauseAfterStep}
            onPauseAfterStepChange={(value) => update({ pauseAfterStep: value })}
            active={settings.tab === 'run'}
            preflight={preflightResult}
            onPreflight={() => void runPreflight()}
            onGoToPipeline={() => setTab('pipeline')}
            onGoToSetup={goToSetup}
            onNotice={setNotice}
          />
        </div>
        {settings.tab === 'traffic' ? <Traffic stream={stream} /> : null}
      </main>
    </div>
  )
}
