import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { PageShell } from '@/components/layout/page-shell'
import { FullWindowShell } from '@/components/layout/full-window-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AgentCard } from '@/components/settings/agent-card'
import { AppCard } from '@/components/settings/app-card'
import { ComposerCard } from '@/components/settings/composer-card'
import { CostCard } from '@/components/settings/cost-card'
import { ModelsCard } from '@/components/settings/models-card'
import { NotificationsCard } from '@/components/settings/notifications-card'
import { ServerCard } from '@/components/settings/server-card'
import { SettingsFilter } from '@/components/settings/settings-filter'
import { SyncCard } from '@/components/settings/sync-card'
import { ThemeCard } from '@/components/settings/theme-card'
import { WordingCard } from '@/components/settings/wording-card'
import { useSimplifySettings } from '@/features/settings/use-simplify-settings'
import { useSessionWording } from '@/features/sessions/use-wording'
import type { SessionWording } from '@/features/sessions/wording'
import { ConnectedProviders } from '@/providers/connected-providers'
import { useSettingsSync } from '@/providers/settings-sync-provider'
import { useIsTouchDevice } from '@/hooks/use-is-touch-device'

type SettingsTab =
  'appearance' | 'preferences' | 'models' | 'notifications' | 'sync' | 'shortcuts' | 'advanced'

const SETTINGS_TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: 'appearance', label: 'Appearance' },
  { value: 'preferences', label: 'Preferences' },
  { value: 'models', label: 'Models' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'sync', label: 'Sync' },
  { value: 'shortcuts', label: 'Shortcuts' },
  { value: 'advanced', label: 'Advanced' },
]

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
  return (
    <FullWindowShell>
      <ConnectedProviders>
        <div className="min-h-0 flex-1">
          <SettingsScreen />
        </div>
      </ConnectedProviders>
    </FullWindowShell>
  )
}

function SettingsScreen() {
  const isTouchDevice = useIsTouchDevice()
  const { simplified } = useSimplifySettings()
  const { serverEnabled } = useSettingsSync()
  const wording = useSessionWording()
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const shortcuts = isTouchDevice ? [] : shortcutList(wording)
  const showSync = serverEnabled
  const tabs = SETTINGS_TABS.filter((item) => {
    if (item.value === 'shortcuts') return !isTouchDevice
    if (item.value === 'sync') return showSync
    return true
  })
  const activeTab = tabs.find((item) => item.value === tab) ?? tabs[0] ?? SETTINGS_TABS[0]

  useEffect(() => {
    if (tab === 'sync' && !showSync) setTab('appearance')
  }, [showSync, tab])

  return (
    <PageShell
      title="Settings"
      description={`Appearance, preferences, models, notifications,${showSync ? ' sync,' : ''}${isTouchDevice ? '' : ' shortcuts,'} and advanced options.`}
      actions={<SettingsFilter />}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between lg:hidden"
            aria-label={`Settings section: ${activeTab.label}`}
          >
            {activeTab.label}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Settings sections</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {tabs.map((item) => {
            const active = item.value === activeTab.value
            return (
              <DropdownMenuItem
                key={item.value}
                onSelect={() => setTab(item.value)}
                aria-current={active ? 'page' : undefined}
                className={active ? 'bg-accent text-accent-foreground' : undefined}
              >
                {item.label}
                {active && <Check className="ml-auto size-4" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <Tabs
        value={activeTab.value}
        onValueChange={(value) => setTab(value as SettingsTab)}
        className="gap-4"
      >
        <TabsList className="hidden lg:inline-flex">
          {tabs.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="appearance" className="space-y-4">
          <ThemeCard />
        </TabsContent>

        <TabsContent value="preferences" className="space-y-4">
          <AgentCard />
          <WordingCard />
          {!isTouchDevice && <ComposerCard />}
          <CostCard />
        </TabsContent>

        <TabsContent value="models" className="space-y-4">
          <ModelsCard />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <NotificationsCard isTouchDevice={isTouchDevice} simplified={simplified} />
        </TabsContent>

        {showSync && (
          <TabsContent value="sync" className="space-y-4">
            <SyncCard />
          </TabsContent>
        )}

        {!isTouchDevice && (
          <TabsContent value="shortcuts">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Keyboard shortcuts</CardTitle>
                <CardDescription>
                  Based on the standard keybinds. The ctrl+x leader stays off while typing so cut
                  keeps working.
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
