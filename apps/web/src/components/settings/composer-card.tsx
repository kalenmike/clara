import { PanelBottom } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useComposerAutoHide } from '@/features/settings/use-composer-auto-hide'

export function ComposerCard() {
  const { enabled, setEnabled } = useComposerAutoHide()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <PanelBottom className="size-4" /> Composer
        </CardTitle>
        <CardDescription>
          Keep the composer out of the way until you need it. Point at its title bar to expand it,
          then move away to collapse it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="auto-hide-composer">Auto-hide the composer</Label>
            <p className="text-[11px] text-muted-foreground">
              The composer rests as its title bar. Pin it open when you want it to stay. Saved on
              this device.
            </p>
          </div>
          <Switch
            id="auto-hide-composer"
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Auto-hide the composer"
          />
        </div>
      </CardContent>
    </Card>
  )
}
