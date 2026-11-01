import { PageShell } from '@/components/layout/page-shell'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgentCard } from '@/components/settings/agent-card'
import { AppCard } from '@/components/settings/app-card'
import { NotificationsCard } from '@/components/settings/notifications-card'
import { ServerCard } from '@/components/settings/server-card'
import { SettingsFilter } from '@/components/settings/settings-filter'
import { ThemeCard } from '@/components/settings/theme-card'
import { WordingCard } from '@/components/settings/wording-card'
import { useSimplifySettings } from '@/features/settings/use-simplify-settings'
import { useSessionWording } from '@/features/sessions/use-wording'
import type { SessionWording } from '@/features/sessions/wording'
import { useIsTouchDevice } from '@/hooks/use-is-touch-device'

function shortcutList(wording: SessionWording): Array<[string, string]> {
  return [
    ['ctrl+x then n', `New ${wording.lowerSingular}`],
    ['ctrl+x then l', `${wording.singular} list`],
    ['ctrl+x then m', 'Model picker'],
    ['ctrl+x then a', 'Agent picker'],
    ['ctrl+x then c', `Compact ${wording.lowerSingular}`],
    ['ctrl+x then s', `${wording.singular} info`],
    ['ctrl+x then g', 'Git changes'],
    ['ctrl+x then `', 'Pair terminal'],
    ['ctrl+x then h', 'Collapse messages'],
    ['ctrl+x then t', 'Toggle light/dark mode'],
    ['ctrl+x then y', 'Copy last reply'],
    ['tab / shift+tab', 'Cycle agent in the message box'],
    ['ctrl+. / ctrl+shift+.', 'Cycle agent from anywhere'],
    ['ctrl+t', 'Cycle model variant'],
    ['escape', 'Interrupt or close'],
    ['shift+enter', 'New line'],
  ]
}

export function SettingsPage() {
  const isTouchDevice = useIsTouchDevice()
  const { simplified } = useSimplifySettings()
  const wording = useSessionWording()
  const shortcuts = isTouchDevice ? [] : shortcutList(wording)

  return (
    <PageShell
      title="Settings"
      description={`Appearance, preferences, notifications,${isTouchDevice ? '' : ' shortcuts,'} and advanced options.`}
      actions={<SettingsFilter />}
    >
      <Tabs defaultValue="appearance" className="gap-4">
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="w-full min-w-max">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
            {!isTouchDevice && <TabsTrigger value="shortcuts">Shortcuts</TabsTrigger>}
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="appearance" className="space-y-4">
          <ThemeCard />
        </TabsContent>

        <TabsContent value="preferences" className="space-y-4">
          <AgentCard />
          <WordingCard />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <NotificationsCard isTouchDevice={isTouchDevice} simplified={simplified} />
        </TabsContent>

        {!isTouchDevice && (
          <TabsContent value="shortcuts">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Keyboard shortcuts</CardTitle>
                <CardDescription>
                  Based on the standard OpenCode keybinds. The ctrl+x leader stays off while typing
                  so cut keeps working.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
                  {shortcuts.map(([keys, action]) => (
                    <div key={keys} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{action}</span>
                      <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="advanced" className="space-y-4">
          <ServerCard simplified={simplified} />
          <AppCard simplified={simplified} />
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
