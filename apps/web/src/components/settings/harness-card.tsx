import { Cable, Loader2, Plus } from 'lucide-react'
import { Link } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useHarnesses } from '@/features/projects/use-projects'

/**
 * Lists the adapters paired with this hub and links to the hub panel, which
 * owns the single pairing flow. The panel runs the install through Clara
 * Desktop's adapter host when it is available, or shows the copy command.
 */
export function HarnessCard({ simplified }: { simplified: boolean }) {
  const harnesses = useHarnesses()
  const rows = harnesses.data ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cable className="size-4" /> Harnesses
        </CardTitle>
        {!simplified && (
          <CardDescription>
            Add a harness by pairing an adapter on the machine that runs it.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {harnesses.isLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Reading harnesses…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No harness is paired yet. Open the hub panel to create a code, then run the command on
            the harness machine or install it with Clara Desktop.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((harness) => (
              <li
                key={harness.harnessID}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"
              >
                <span className="font-medium">{harness.label}</span>
                <span className="text-muted-foreground">{harness.kind}</span>
                <Badge variant={harness.online ? 'default' : 'outline'}>
                  {harness.online ? 'Online' : 'Paired · Offline'}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <Button asChild size="sm">
          <Link to="/hub#harness">
            <Plus className="size-4" /> Pair harness
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
