import { Link } from 'react-router'
import { Activity } from 'lucide-react'
import type { ClaraProject } from '@clara/api-contract'
import { ProjectActionsMenu } from '@/components/projects/project-actions'
import { ProjectAvatar } from '@/components/projects/project-avatar'
import { Badge } from '@clara/ui/components/badge'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@clara/ui/components/card'
import { Skeleton } from '@clara/ui/components/skeleton'
import { projectLabel, projectWorkspaceSummary } from '@/features/projects/project-list'
import { describePartialHarnesses, type ProjectStats } from '@/features/projects/project-stats'
import { useProjectStats } from '@/features/projects/use-project-stats'
import { useSessionWording } from '@/features/sessions/use-wording'
import { formatCount, formatRelativeTime } from '@/lib/format'

export function ProjectCard({ project }: { project: ClaraProject }) {
  const statsQuery = useProjectStats(project.id)
  const { lowerPlural } = useSessionWording()
  const stats = statsQuery.data
  const label = projectLabel(project)

  return (
    <Card className="group relative h-full gap-3 py-4 transition-colors hover:ring-foreground/25 focus-within:ring-foreground/25">
      <Link
        to={`/p/${project.id}`}
        aria-label={`Open ${label}`}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <CardHeader className="pointer-events-none relative z-10 px-4">
        <div className="flex min-w-0 items-start gap-3">
          <ProjectAvatar project={project} size="sm" />
          <CardTitle className="min-w-0 flex-1 text-sm">
            <span className="min-w-0">
              <span className="line-clamp-1">{label}</span>
              <span className="mt-1 block truncate font-mono text-[11px] font-normal text-muted-foreground">
                {projectWorkspaceSummary(project)}
              </span>
            </span>
          </CardTitle>
        </div>
        <CardAction className="pointer-events-auto">
          <ProjectActionsMenu project={project} />
        </CardAction>
      </CardHeader>
      <CardContent className="pointer-events-none relative z-10 space-y-3 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {project.time.archived !== undefined && (
            <Badge variant="outline" className="text-[10px]">
              Archived
            </Badge>
          )}
          {statsQuery.isLoading ? (
            <>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </>
          ) : statsQuery.isError || !stats ? (
            <span className="text-[11px] text-muted-foreground">Counts unavailable</span>
          ) : (
            <>
              <Badge variant="secondary" className="text-[10px]">
                {formatCount(stats.active)} active
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {formatCount(stats.archived)} archived
              </Badge>
              <PartialBadge stats={stats} />
            </>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Activity className="size-3.5" />
            {formatRelativeTime(project.time.active)}
          </span>
          <span
            title={stats?.truncated ? 'Counts are capped at the first 1000 sessions' : undefined}
          >
            {stats
              ? `${formatCount(stats.total)}${stats.truncated ? '+' : ''} ${lowerPlural}`
              : `— ${lowerPlural}`}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function PartialBadge({ stats }: { stats: ProjectStats }) {
  if (!stats.partial) return null
  return (
    <Badge
      variant="outline"
      className="text-[10px] text-muted-foreground"
      title={describePartialHarnesses(stats.harnesses)}
    >
      partial
    </Badge>
  )
}
