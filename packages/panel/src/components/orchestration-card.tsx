import { useState } from 'react'
import { Workflow } from 'lucide-react'
import type { PanelOrchestrationControl, PanelOrchestrationState } from '@clara/shared-types'
import { postPanel } from '../lib/panel-api.ts'
import { usePeek } from '../lib/peek-context.tsx'
import {
  Badge,
  CardBody,
  CollapsibleCard,
  Notice,
  Toggle,
  type ToggleState,
} from './primitives.tsx'

const STATE_LABELS: Record<PanelOrchestrationState, string> = {
  local: 'Running locally',
  container: 'Running in Docker',
  external: 'Running externally',
  stopped: 'Stopped',
  unresponsive: 'Not responding',
  foreign: 'Port in use',
}

/**
 * The orchestration service owns package runs and the worker sessions that
 * appear separately in Clara. The panel can start and stop a local instance;
 * container and external instances stay under their own management.
 */
export function OrchestrationCard({
  orchestration,
  onChanged,
  defaultExpanded = false,
}: {
  orchestration: PanelOrchestrationControl
  onChanged: () => void
  defaultExpanded?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  const { redact } = usePeek()

  const managedElsewhere = orchestration.state === 'container' || orchestration.state === 'external'
  const update = async () => {
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/orchestration', { enabled: !orchestration.effective })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const toggleState: ToggleState = pending ? 'pending' : orchestration.effective ? 'on' : 'off'
  const tone = orchestration.effective
    ? 'success'
    : orchestration.state === 'foreign' || orchestration.state === 'unresponsive'
      ? 'danger'
      : 'neutral'
  const message = error ?? orchestration.error

  return (
    <CollapsibleCard
      title="Orchestration"
      description="Package runs, worker sessions, and result delivery"
      icon={<Workflow className="size-4" aria-hidden="true" />}
      defaultExpanded={defaultExpanded}
      action={
        <Badge tone={tone}>
          {orchestration.effective ? 'On' : STATE_LABELS[orchestration.state]}
        </Badge>
      }
      control={
        <Toggle
          checked={orchestration.effective}
          onChange={() => void update()}
          label={`Orchestration: ${orchestration.effective ? 'on' : 'off'}`}
          state={toggleState}
          disabled={pending || managedElsewhere}
        />
      }
      notice={
        message ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{redact(message)}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <p className="text-xs text-muted-foreground">
          When on, the hub service keeps a local orchestration service running at{' '}
          <code className="break-all rounded bg-muted px-1 py-0.5">{orchestration.url}</code>.
          Worker sessions are grouped separately in Clara and their pushes stay quiet.
        </p>

        <p className="pt-2 text-[11px] text-muted-foreground">
          {managedElsewhere
            ? 'This instance was not started from the panel. Stop it with the command that started it.'
            : `State: ${STATE_LABELS[orchestration.state]}. Turning it off stops only a local instance started from this data directory.`}
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
