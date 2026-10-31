import {
  Bell,
  BellOff,
  CircleAlert,
  ClipboardCheck,
  Eye,
  MessageCircleQuestion,
  Play,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  ATTENTION_DESCRIPTIONS,
  ATTENTION_KINDS,
  ATTENTION_LABELS,
  type AttentionKind,
} from '@/features/notifications/attention'
import { requestNotificationPermission } from '@/features/notifications/notifier'
import { useNotificationPermission } from '@/features/notifications/use-notification-permission'
import { useNotificationSettings } from '@/features/notifications/use-notification-settings'
import { playAttentionSound, playDoneSound } from '@/features/notifications/sounds'

const KIND_ICONS: Record<AttentionKind, typeof Eye> = {
  review: Eye,
  question: MessageCircleQuestion,
  plan: ClipboardCheck,
  error: CircleAlert,
}

export function NotificationsCard() {
  const { settings, update } = useNotificationSettings()
  const { permission, setPermission } = useNotificationPermission()

  const supported = permission !== 'unsupported'
  const desktopEnabled = permission === 'granted' && settings.desktop

  const toggleDesktop = async (enabled: boolean) => {
    if (!enabled) {
      update({ desktop: false })
      return
    }
    if (permission === 'granted') {
      update({ desktop: true })
      return
    }
    if (permission === 'denied') return

    const next = await requestNotificationPermission()
    setPermission(next)
    if (next === 'granted') update({ desktop: true })
  }

  const toggleSound = (kind: AttentionKind, enabled: boolean) => {
    update({ soundKinds: { ...settings.soundKinds, [kind]: enabled } })
  }

  const toggleUiSounds = (enabled: boolean) => {
    update({ uiSounds: enabled })
    if (enabled) playDoneSound(settings.volume)
  }

  const desktopDescription =
    permission === 'unsupported'
      ? 'This browser cannot show system notifications here.'
      : permission === 'denied'
        ? 'Blocked by the browser. Allow notifications for this site in browser settings.'
        : permission === 'default'
          ? 'Turn this on to ask the browser for permission.'
          : 'Show a system notification when a session needs you.'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" /> Notifications &amp; sounds
        </CardTitle>
        <CardDescription>
          Inbox alerts, system notifications, and sound preferences.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm">Desktop notifications</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{desktopDescription}</p>
          </div>
          <Switch
            checked={desktopEnabled}
            onCheckedChange={(checked) => void toggleDesktop(checked)}
            disabled={!supported || permission === 'denied'}
            aria-label="Desktop notifications"
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {settings.sounds ? <Volume2 className="size-4" /> : <BellOff className="size-4" />}
            <div>
              <div className="text-sm">Inbox notification sounds</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Play a distinct sound for each Inbox state.
              </p>
            </div>
          </div>
          <Switch
            checked={settings.sounds}
            onCheckedChange={(checked) => update({ sounds: checked })}
            aria-label="Inbox notification sounds"
          />
        </div>

        <div className="flex items-center gap-3 pl-6">
          <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
          <Slider
            value={[Math.round(settings.volume * 100)]}
            onValueChange={([value]) => update({ volume: value / 100 })}
            disabled={!settings.sounds && !settings.uiSounds}
            aria-label="Sound volume"
          />
          <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {Math.round(settings.volume * 100)}%
          </span>
        </div>

        <div className="space-y-1 rounded-lg border p-2">
          {ATTENTION_KINDS.map((kind) => {
            const Icon = KIND_ICONS[kind]
            return (
              <div key={kind} className="flex items-center gap-2 rounded-md px-1 py-1.5">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{ATTENTION_LABELS[kind]}</div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {ATTENTION_DESCRIPTIONS[kind]}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => playAttentionSound(kind, settings.volume, true)}
                  aria-label={`Preview the ${ATTENTION_LABELS[kind]} sound`}
                  title="Preview"
                >
                  <Play className="size-3" />
                </Button>
                <Switch
                  size="sm"
                  checked={settings.soundKinds[kind]}
                  onCheckedChange={(checked) => toggleSound(kind, checked)}
                  disabled={!settings.sounds}
                  aria-label={`${ATTENTION_LABELS[kind]} sound`}
                />
              </div>
            )
          })}
        </div>

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {settings.uiSounds ? <Sparkles className="size-4" /> : <VolumeX className="size-4" />}
            <div>
              <div className="text-sm">UI sounds</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Play a chime when you finish an action, like marking a session Done.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => playDoneSound(settings.volume)}
              aria-label="Preview the UI sound"
              title="Preview"
            >
              <Play className="size-3" />
            </Button>
            <Switch
              checked={settings.uiSounds}
              onCheckedChange={toggleUiSounds}
              aria-label="UI sounds"
            />
          </div>
        </div>

        {permission === 'unsupported' && (
          <p className="text-[11px] text-muted-foreground">
            System notifications need a secure browser context.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
