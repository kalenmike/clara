import { ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useShowEmptyProjects } from '@/features/projects/use-show-empty-projects'

export function ProjectFilter() {
  const { showEmpty, setShowEmpty } = useShowEmptyProjects()

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
            Empty projects are hidden by default. This preference is saved on this device.
          </PopoverDescription>
        </PopoverHeader>
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
      </PopoverContent>
    </Popover>
  )
}
