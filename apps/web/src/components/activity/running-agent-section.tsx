import { WifiOff } from 'lucide-react'
import type { ClaraActivityHarness, ClaraProject, ClaraRunningSession } from '@clara/api-contract'
import { RunningAgentCard } from '@/components/activity/running-agent-card'
import { Badge } from '@/components/ui/badge'
import { runningSessionPath } from '@/features/activity/running-activity'
import { projectLabel } from '@/features/projects/project-list'

export function RunningAgentSection({
  harness,
  sessions,
  projectByID,
  projectIDs,
}: {
  harness: ClaraActivityHarness
  sessions: ClaraRunningSession[]
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
            {sessions.length} running
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400">
            Partial
          </Badge>
        )}
        {harness.active && (
          <Badge variant="outline" className="text-[10px]">
            Active harness
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
            <RunningAgentCard
              key={`${item.harnessID}:${item.session.id}`}
              item={item}
              harness={harness}
              projectName={project ? projectLabel(project) : item.session.projectID}
              href={runningSessionPath(item, harness, projectIDs)}
            />
          )
        })}
      </div>
    </section>
  )
}
