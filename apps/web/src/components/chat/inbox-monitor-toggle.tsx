import { useId } from 'react'
import { CircleDot, Inbox } from 'lucide-react'
import { Label } from '@clara/ui/components/label'
import { Switch } from '@clara/ui/components/switch'
import { useInboxMonitor } from '@/features/sessions/inbox-monitor'
import { useSessionWording } from '@/features/sessions/use-wording'

export function InboxMonitorToggle() {
  const id = useId()
  const descriptionID = `${id}-description`
  const { active, toggle, projectID, outboxCount } = useInboxMonitor()
  const { lowerSingular, lowerPlural } = useSessionWording()
  const working = outboxCount > 0

  return (
    <div className="w-full max-w-sm rounded-xl border bg-card p-3 text-left">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Label htmlFor={id} className="text-sm">
            <Inbox className="size-4 text-muted-foreground" />
            Auto-open latest {lowerSingular}
          </Label>
          <p id={descriptionID} className="mt-1 text-xs text-muted-foreground">
            Automatically open your active {lowerPlural} when none is selected, or return here.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {working ? (
              <CircleDot className="size-3 shrink-0 animate-pulse text-emerald-500" />
            ) : (
              <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
            )}
            <span>
              {working
                ? `${outboxCount} ${outboxCount === 1 ? lowerSingular : lowerPlural} in progress`
                : `No ${lowerPlural} in progress.`}
            </span>
          </p>
        </div>
        <Switch
          id={id}
          checked={active}
          onCheckedChange={toggle}
          disabled={!projectID}
          aria-describedby={descriptionID}
        />
      </div>
    </div>
  )
}
