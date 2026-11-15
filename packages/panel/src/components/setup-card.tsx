import { Settings2 } from 'lucide-react'
import type { SetupPreferences, SetupState } from '../lib/onboarding.ts'
import { Badge, CardBody, CollapsibleCard, Notice } from './primitives.tsx'

export function SetupCard({
  setup,
  preferences,
  onOpenSetup,
  onOpenReconfigure,
  onOpenGuide,
}: {
  setup: SetupState
  preferences: SetupPreferences
  onOpenSetup: () => void
  onOpenReconfigure: () => void
  onOpenGuide: () => void
}) {
  const pathLabel =
    setup.path === 'relay'
      ? 'Remote via relay'
      : setup.path === 'local'
        ? 'Local only'
        : 'Not chosen'

  return (
    <CollapsibleCard
      title="Setup"
      description="Connection path, guided setup, and the quick tour"
      icon={<Settings2 className="size-4" aria-hidden="true" />}
      action={
        <Badge tone={setup.requiredDone ? 'success' : 'warning'}>
          {setup.requiredDone ? 'Complete' : `${setup.progress.done}/${setup.progress.total}`}
        </Badge>
      }
      defaultExpanded={false}
    >
      <CardBody>
        {setup.requiredDone ? (
          <>
            <p className="text-xs text-foreground">
              Connection path: <strong className="font-medium">{pathLabel}</strong>. Reconfigure
              only when you want to change the path or repair a pairing.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={onOpenReconfigure} className="panel-button">
                Reconfigure connections
              </button>
              <button type="button" onClick={onOpenGuide} className="panel-button">
                Replay setup guide
              </button>
            </div>
            {preferences.guideSeenAt ? null : (
              <p className="panel-muted text-[10px]">
                The guide has not been viewed yet. Replay it above at any time.
              </p>
            )}
            <Notice>
              Changing the connection path or relay room can require adapters and devices to pair
              again.
            </Notice>
          </>
        ) : (
          <>
            <p className="text-xs text-foreground">
              Setup is incomplete. The hub works, but a harness or client still needs to be paired.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={onOpenSetup} className="panel-button primary">
                Finish setup
              </button>
            </div>
            <p className="panel-muted text-[10px]">
              {setup.progress.done} of {setup.progress.total} required steps complete.
            </p>
          </>
        )}
      </CardBody>
    </CollapsibleCard>
  )
}
