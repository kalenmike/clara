import { WifiOff } from 'lucide-react'
import type { ClaraActivityHarness, ClaraActivitySession, ClaraProject } from '@clara/api-contract'
import { ActivityCard } from '@/components/activity/activity-card'
import { Badge } from '@clara/ui/components/badge'
import { activitySessionPath } from '@/features/activity/activity-sessions'
import { projectLabel } from '@/features/projects/project-list'

export function ActivityHarnessSection({
  harness,
  sessions,
  projectByID,
  projectIDs,
}: {
  harness: ClaraActivityHarness
  sessions: ClaraActivitySession[]
  projectByID: ReadonlyMap<string, ClaraProject>
  projectIDs: ReadonlySet<string>
}) {
  return (
    <section className="space-y-3" aria-label={harness.label}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{harness.label}</h2>
        {!harness.online ? (
          <Badge variant="outline" className="gap-1 text-[10px]">
            <WifiOff className="size-3" /> Offline
          </Badge>
        ) : harness.ok ? (
          <Badge variant="secondary" className="text-[10px]">
            {sessions.length} active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">
            Partial
          </Badge>
        )}
      </div>

      {harness.message && (
        <p className="break-words text-[11px] text-muted-foreground">{harness.message}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {sessions.map((item) => {
          const project = projectByID.get(item.session.projectID)
          return (
            <ActivityCard
              key={`${item.harnessID}:${item.session.id}`}
              item={item}
              harness={harness}
              projectName={project ? projectLabel(project) : item.session.projectID}
              href={activitySessionPath(item, harness, projectIDs)}
            />
          )
        })}
      </div>
    </section>
  )
}
