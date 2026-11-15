import { useCallback, useEffect, useState } from 'react'
import { pickDirectory, preflight, reconnect, registerAdapter, removeAdapter } from './api'
import { Console } from './components/Console'
import { Icon } from './components/Icon'
import { Preview } from './components/Preview'
import { Runs } from './components/Runs'
import { SettingsView } from './components/Settings'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
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
  const [browsing, setBrowsing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [runsFocus, setRunsFocus] = useState<number | undefined>()
  const [reviewFocus, setReviewFocus] = useState<number | undefined>()

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

  const hostWorkspace = settings.hostWorkspace.trim() || stream.snapshot?.workspace || ''
  const runtimeWorkspace = stream.snapshot?.engineWorkspace || ''

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

  const browseHostWorkspace = async (): Promise<void> => {
    setBrowsing(true)
    setPreflightError(null)
    try {
      const result = await pickDirectory(hostWorkspace || undefined)
      if (result.path) update({ hostWorkspace: result.path })
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBrowsing(false)
    }
  }

  const setTab = (tab: LabTab): void => {
    update({ tab })
  }

  const openRun = useCallback(
    (runID: number): void => {
      setRunsFocus(runID)
      update({ tab: 'runs' })
    },
    [update]
  )

  const openReview = useCallback(
    (runID: number): void => {
      setReviewFocus(runID)
      update({ tab: 'pipeline' })
    },
    [update]
  )

  const clearRunsFocus = useCallback((): void => setRunsFocus(undefined), [])
  const clearReviewFocus = useCallback((): void => setReviewFocus(undefined), [])

  const enableAdapter = async (): Promise<void> => {
    if (!runtimeWorkspace) {
      setPreflightError('The engine has not reported its workspace yet.')
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

  const removeAdapterNow = async (id: string): Promise<void> => {
    try {
      await removeAdapter(id)
      setNotice('Removed the lab adapter.')
      await runPreflight()
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const reconnectNow = async (): Promise<void> => {
    try {
      await reconnect()
      setNotice('Reconnected to the engine.')
      await runPreflight()
    } catch (cause) {
      setPreflightError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (!stream.snapshot) {
    return (
      <div className="boot">
        <div className="boot-mark">C</div>
        <h1>Clara Lab</h1>
        <p className="muted">{stream.error ?? 'Connecting to the lab server…'}</p>
      </div>
    )
  }

  const snapshot = stream.snapshot
  const runtimeError = snapshot.lastError ? friendlyError(snapshot.lastError, 'runtime') : null
  const setupIssues = preflightResult
    ? [
        preflightResult.host.ok,
        preflightResult.runtime.ok,
        !preflightResult.adapter.required || preflightResult.adapter.ok,
      ].filter((ok) => !ok).length
    : 0

  return (
    <div className="shell">
      <header className="titlebar">
        <div className="titlebar-brand">
          <span className="titlebar-mark">C</span>
          <strong>Clara Lab</strong>
          <span className="titlebar-tag">local tooling</span>
        </div>
        <div className="titlebar-path" title={hostWorkspace || undefined}>
          <Icon name="folder" size={13} />
          <code>{hostWorkspace || 'No workspace selected'}</code>
        </div>
        <div className="titlebar-meta">{snapshot.engine}</div>
      </header>

      <Sidebar
        tab={settings.tab}
        onTab={setTab}
        workCount={snapshot.work.length}
        callCount={stream.calls.length}
        setupIssues={setupIssues}
      />

      <main className="workbench">
        {stream.error ? <div className="banner warn">{stream.error}</div> : null}
        {runtimeError ? (
          <div className="banner warn">
            <strong>{runtimeError.title}.</strong> {runtimeError.hint ?? runtimeError.detail}
          </div>
        ) : null}
        {notice ? <div className="banner ok">{notice}</div> : null}

        <div className="view-slot" hidden={settings.tab !== 'pipeline'}>
          <Preview
            stream={stream}
            hostWorkspace={hostWorkspace}
            runtimeWorkspace={runtimeWorkspace}
            target={settings.target}
            onTargetChange={(target) => update({ target })}
            pauseAfterStep={settings.pauseAfterStep}
            onPauseAfterStepChange={(value) => update({ pauseAfterStep: value })}
            active={settings.tab === 'pipeline'}
            preflight={preflightResult}
            onPreflight={() => void runPreflight()}
            onOpenSettings={() => setTab('settings')}
            onNotice={setNotice}
            onOpenRun={openRun}
            focusRunID={reviewFocus}
            onFocusHandled={clearReviewFocus}
          />
        </div>
        <div className="view-slot" hidden={settings.tab !== 'runs'}>
          <Runs
            stream={stream}
            hostWorkspace={hostWorkspace}
            active={settings.tab === 'runs'}
            showDebugRuns={settings.showDebugRuns}
            onShowDebugRunsChange={(value) => update({ showDebugRuns: value })}
            focusRunID={runsFocus}
            onFocusHandled={clearRunsFocus}
            onOpenReview={openReview}
            onNotice={setNotice}
          />
        </div>
        <div className="view-slot" hidden={settings.tab !== 'traffic'}>
          <Traffic stream={stream} />
        </div>
        <div className="view-slot" hidden={settings.tab !== 'console'}>
          <Console stream={stream} />
        </div>
        <div className="view-slot" hidden={settings.tab !== 'settings'}>
          <SettingsView
            snapshot={snapshot}
            hostWorkspace={settings.hostWorkspace}
            onHostWorkspace={(value) => update({ hostWorkspace: value })}
            browsing={browsing}
            onBrowse={() => void browseHostWorkspace()}
            preflight={preflightResult}
            loading={preflightLoading}
            error={preflightError}
            onCheck={() => void runPreflight()}
            onReconnect={() => void reconnectNow()}
            onEnableAdapter={() => void enableAdapter()}
            onRemoveAdapter={(id) => void removeAdapterNow(id)}
          />
        </div>
      </main>

      <StatusBar
        snapshot={snapshot}
        workspace={hostWorkspace}
        preflight={preflightResult}
        preflightError={preflightError}
        onTab={setTab}
      />
    </div>
  )
}
