import { useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { PanelSnapshot } from '@clara/shared-types'
import type { SetupPath, SetupState } from '../../lib/onboarding.ts'
import type { SetupModalMode } from '../../lib/use-onboarding.ts'
import { ClientStep } from './client-step.tsx'
import { ConnectionStep } from './connection-step.tsx'
import { GuideStep } from './guide-step.tsx'
import { HarnessStep } from './harness-step.tsx'

type ModalStep = 'connection' | 'harness' | 'client' | 'ready' | 'guide'

const STEP_LABELS: Array<{ id: Exclude<ModalStep, 'guide'>; label: string }> = [
  { id: 'connection', label: 'Connection path' },
  { id: 'harness', label: 'Harness' },
  { id: 'client', label: 'Client' },
  { id: 'ready', label: 'Ready' },
]

export function SetupModal({
  open,
  mode,
  snapshot,
  setup,
  now,
  onChanged,
  onPathChange,
  onClose,
  onFinish,
}: {
  open: boolean
  mode: SetupModalMode
  snapshot: PanelSnapshot
  setup: SetupState
  now: number
  onChanged: () => void
  onPathChange: (path: SetupPath) => void
  onClose: () => void
  onFinish: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [step, setStep] = useState<ModalStep>(() => initialStep(mode, setup))

  useEffect(() => {
    if (!open) return
    setStep(initialStep(mode, setup))
    // Only reset when the modal is opened or its mode changes; the snapshot
    // refreshes every five seconds and must not move the user between steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  if (!open) return null

  const isGuide = step === 'guide'
  const stepIndex = STEP_LABELS.findIndex((item) => item.id === step)
  const canContinue =
    step === 'connection'
      ? setup.connectionReady
      : step === 'harness'
        ? setup.harnessReady
        : step === 'client'
          ? setup.clientReady
          : true
  const title = isGuide
    ? 'How Clara works'
    : mode === 'reconfigure'
      ? 'Reconfigure Clara'
      : 'Finish setting up Clara'
  const description = isGuide
    ? 'What the hub, adapters, relay, and paired clients do.'
    : mode === 'reconfigure'
      ? 'Change the connection path or update the harness and client pairing.'
      : 'Choose how devices connect, pair your harness, then pair a client.'

  const next = () => {
    if (step === 'connection') setStep('harness')
    else if (step === 'harness') setStep('client')
    else if (step === 'client') setStep('ready')
    else onFinish()
  }

  const back = () => {
    if (step === 'harness') setStep('connection')
    else if (step === 'client') setStep('harness')
    else if (step === 'ready') setStep('client')
  }

  return (
    <dialog
      ref={dialogRef}
      className="panel-setup-dialog"
      aria-labelledby="panel-setup-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="panel-setup-card">
        <header className="panel-setup-head">
          <div className="min-w-0">
            <div className="panel-muted text-[10px] font-semibold tracking-[0.08em] uppercase">
              Clara hub
            </div>
            <h2 id="panel-setup-title" className="mt-0.5 text-base font-semibold">
              {title}
            </h2>
            <p className="panel-muted mt-1 text-xs">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close setup"
            className="panel-icon-button shrink-0"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {isGuide ? null : (
          <div className="panel-setup-progress">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-medium">
                <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
                Owner account
              </span>
              {STEP_LABELS.map((item, index) => {
                const done =
                  item.id === 'connection'
                    ? setup.connectionReady
                    : item.id === 'harness'
                      ? setup.harnessReady
                      : item.id === 'client'
                        ? setup.clientReady
                        : setup.requiredDone
                return (
                  <span
                    key={item.id}
                    className={`flex items-center gap-1.5 text-[11px] ${
                      item.id === step
                        ? 'font-semibold text-[color:var(--panel-text)]'
                        : 'panel-muted'
                    }`}
                  >
                    <span
                      className={`grid size-4 place-items-center rounded-full border text-[9px] ${
                        done
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'border-[color:var(--panel-border)] text-[color:var(--panel-faint)]'
                      }`}
                      aria-hidden="true"
                    >
                      {done ? <Check className="size-2.5" /> : index + 1}
                    </span>
                    {item.label}
                  </span>
                )
              })}
            </div>
            <span className="panel-muted text-[10px]">
              {setup.progress.done} of {setup.progress.total} required steps
            </span>
          </div>
        )}

        <div className="panel-setup-body">
          {step === 'connection' ? (
            <ConnectionStep
              snapshot={snapshot}
              setup={setup}
              now={now}
              onChanged={onChanged}
              onPathChange={onPathChange}
            />
          ) : step === 'harness' ? (
            <HarnessStep snapshot={snapshot} setup={setup} now={now} onChanged={onChanged} />
          ) : step === 'client' ? (
            <ClientStep snapshot={snapshot} setup={setup} now={now} onChanged={onChanged} />
          ) : (
            <GuideStep snapshot={snapshot} setup={setup} />
          )}
        </div>

        <footer className="panel-setup-foot">
          <div>
            {isGuide ? (
              <button type="button" onClick={onFinish} className="panel-button">
                Close
              </button>
            ) : (
              <button type="button" onClick={onClose} className="panel-link text-xs">
                Skip for now
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!isGuide && stepIndex > 0 ? (
              <button type="button" onClick={back} className="panel-button">
                <ChevronLeft className="size-3.5" aria-hidden="true" />
                Back
              </button>
            ) : null}
            {isGuide ? (
              <button type="button" onClick={onFinish} className="panel-button primary">
                Done
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                disabled={!canContinue}
                className="panel-button primary"
              >
                {step === 'ready' ? 'Done' : 'Continue'}
                {step === 'ready' ? null : <ChevronRight className="size-3.5" aria-hidden="true" />}
              </button>
            )}
          </div>
        </footer>
      </div>
    </dialog>
  )
}

function initialStep(mode: SetupModalMode, setup: SetupState): ModalStep {
  if (mode === 'guide') return 'guide'
  if (mode === 'reconfigure') return 'connection'
  return setup.current
}
