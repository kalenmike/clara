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
import { useSimplifySettings } from '@/features/settings/use-simplify-settings'

export function SettingsFilter() {
  const { simplified, setSimplified } = useSimplifySettings()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 max-md:size-11"
          aria-label="Filter settings"
          title="Filter settings"
        >
          <ListFilter className="size-5 md:size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <PopoverHeader>
          <PopoverTitle>Filter settings</PopoverTitle>
          <PopoverDescription>
            Simplified settings hide the details you rarely change. This preference is saved on this
            device.
          </PopoverDescription>
        </PopoverHeader>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="simplify-settings" className="font-normal">
            Simplify settings
          </Label>
          <Switch
            id="simplify-settings"
            checked={simplified}
            onCheckedChange={setSimplified}
            aria-label="Simplify settings"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
