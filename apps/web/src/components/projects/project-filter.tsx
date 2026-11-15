import { ListFilter } from 'lucide-react'
import { Button } from '@clara/ui/components/button'
import { Label } from '@clara/ui/components/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@clara/ui/components/popover'
import { Switch } from '@clara/ui/components/switch'
import { useShowArchivedProjects } from '@/features/projects/use-show-archived-projects'
import { useShowEmptyProjects } from '@/features/projects/use-show-empty-projects'

export function ProjectFilter() {
  const { showEmpty, setShowEmpty } = useShowEmptyProjects()
  const { showArchived, setShowArchived } = useShowArchivedProjects()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 max-md:size-11"
          aria-label="Filter projects"
          title="Filter projects"
        >
          <ListFilter className="size-5 md:size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>Filter projects</PopoverTitle>
          <PopoverDescription>
            Empty and archived projects are hidden by default. These preferences are saved on this
            device.
          </PopoverDescription>
        </PopoverHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="show-empty-projects" className="font-normal">
              Show empty projects
            </Label>
            <Switch
              id="show-empty-projects"
              checked={showEmpty}
              onCheckedChange={setShowEmpty}
              aria-label="Show empty projects"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="show-archived-projects" className="font-normal">
              Show archived projects
            </Label>
            <Switch
              id="show-archived-projects"
              checked={showArchived}
              onCheckedChange={setShowArchived}
              aria-label="Show archived projects"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
