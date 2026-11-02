import { useState } from 'react'
import { Workflow } from 'lucide-react'
import type { PanelManagementControl } from '@clara/shared-types'
import { postPanel } from '../lib/panel-api.ts'
import {
  Badge,
  CardBody,
  CollapsibleCard,
  Notice,
  Toggle,
  type ToggleState,
} from './primitives.tsx'

/**
 * Clara management is the master switch for the ledger daemon, ledger alerts,
 * and the Clara inbox. Turning it off leaves ordinary OpenCode session alerts
 * untouched.
 */
export function ManagementCard({
  management,
  onChanged,
}: {
  management: PanelManagementControl
  onChanged: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  const update = async () => {
    setPending(true)
    setError(undefined)
    try {
      await postPanel('/panel/api/v1/management', { enabled: !management.enabled })
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }

  const toggleState: ToggleState = pending ? 'pending' : management.enabled ? 'on' : 'off'

  return (
    <CollapsibleCard
      title="Clara management"
      description="Ledger daemon, Clara agents, exception alerts, and the inbox"
      icon={<Workflow className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={management.enabled ? 'success' : 'neutral'}>
          {management.enabled ? 'On' : 'Off'}
        </Badge>
      }
      control={
        <Toggle
          checked={management.enabled}
          onChange={() => void update()}
          label={`Clara management: ${management.enabled ? 'on' : 'off'}`}
          state={toggleState}
          disabled={pending}
        />
      }
      notice={
        error ? (
          <div className="px-4 pt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null
      }
    >
      <CardBody>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          When on, the OpenCode plugin may run the Clara ledger daemon, the Clara agents are
          available, and the home agent delivers ledger exceptions as Clara alerts. Turning it off
          disables the Clara tools, daemon, and agents immediately and leaves ordinary session
          alerts unchanged.
        </p>

        <p className="pt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          The switch also hides or restores the Clara agents in OpenCode. The home agent rewrites
          the installed agent files and reloads OpenCode; files edited after installation are left
          untouched. Tool access changes without a reload.
        </p>
      </CardBody>
    </CollapsibleCard>
  )
}
