import { useState } from 'react'
import {
  Bell,
  BellOff,
  CircleAlert,
  ClipboardCheck,
  Eye,
  MessageCircleQuestion,
  Play,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@clara/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@clara/ui/components/card'
import { Separator } from '@clara/ui/components/separator'
import { Slider } from '@clara/ui/components/slider'
import { Switch } from '@clara/ui/components/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import {
  ATTENTION_DESCRIPTIONS,
  ATTENTION_KINDS,
  ATTENTION_LABELS,
  type AttentionKind,
} from '@/features/notifications/attention'
import {
  readNotificationPermission,
  requestNotificationPermission,
  showTestDesktopNotification,
  type NotificationPermissionState,
} from '@/features/notifications/notifier'
import { useNotificationPermission } from '@/features/notifications/use-notification-permission'
import { useNotificationSettings } from '@/features/notifications/use-notification-settings'
import { playAttentionSound, playDoneSound } from '@/features/notifications/sounds'
import { DESK_IDLE_OPTIONS_MS, simplifiedInboxSoundPatch } from '@/features/notifications/settings'
import { usePush } from '@/providers/push-provider'
import { useSessionWording } from '@/features/sessions/use-wording'

const KIND_ICONS: Record<AttentionKind, typeof Eye> = {
  review: Eye,
  question: MessageCircleQuestion,
  plan: ClipboardCheck,
  error: CircleAlert,
}

export function NotificationsCard({
  isTouchDevice,
  simplified,
}: {
  isTouchDevice: boolean
  simplified: boolean
}) {
  const { settings, update } = useNotificationSettings()
  const { permission, setPermission } = useNotificationPermission()
  const { lowerSingular } = useSessionWording()

  // Hide the desktop-only row on touch devices, but keep it reachable while a
  // previous session has it enabled so it can still be switched off.
  const showDesktop = !isTouchDevice || settings.desktop

  const toggleInboxSounds = (enabled: boolean) => {
    update(simplified ? simplifiedInboxSoundPatch(enabled) : { sounds: enabled })
  }

  const toggleSound = (kind: AttentionKind, enabled: boolean) => {
    update({ soundKinds: { ...settings.soundKinds, [kind]: enabled } })
  }

  const toggleUiSounds = (enabled: boolean) => {
    update({ uiSounds: enabled })
    if (enabled) playDoneSound(settings.volume)
  }

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
        {showDesktop && (
          <>
            <DesktopNotificationsSetting permission={permission} setPermission={setPermission} />
            <Separator />
          </>
        )}

        <PushNotificationsSetting setPermission={setPermission} isTouchDevice={isTouchDevice} />

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
            onCheckedChange={toggleInboxSounds}
            aria-label="Inbox notification sounds"
          />
        </div>

        {!simplified && (
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
        )}

        {!simplified && (
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
                    className="max-md:size-11"
                    onClick={() => playAttentionSound(kind, settings.volume, true)}
                    aria-label={`Preview the ${ATTENTION_LABELS[kind]} sound`}
                    title="Preview"
                  >
                    <Play className="size-3 max-md:size-5" />
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
        )}

        <Separator />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {settings.uiSounds ? <Sparkles className="size-4" /> : <VolumeX className="size-4" />}
            <div>
              <div className="text-sm">UI sounds</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Play a chime for UI actions, like marking a {lowerSingular} Done or starting work.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="max-md:size-11"
              onClick={() => playDoneSound(settings.volume)}
              aria-label="Preview the UI sound"
              title="Preview"
            >
              <Play className="size-3 max-md:size-5" />
            </Button>
            <Switch
              checked={settings.uiSounds}
              onCheckedChange={toggleUiSounds}
              aria-label="UI sounds"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DesktopNotificationsSetting({
  permission,
  setPermission,
}: {
  permission: NotificationPermissionState
  setPermission: (permission: NotificationPermissionState) => void
}) {
  const { settings, update } = useNotificationSettings()
  const { lowerSingular } = useSessionWording()
  const [testing, setTesting] = useState(false)

  const supported = permission !== 'unsupported'
  const desktopEnabled = permission === 'granted' && settings.desktop

  const sendTest = async () => {
    setTesting(true)
    try {
      const sent = await showTestDesktopNotification()
      if (sent) {
        toast.success('Test notification sent')
      } else {
        toast.error('Could not send a test notification', {
          description: 'Allow notifications for Clara in your browser and system settings.',
        })
      }
    } finally {
      setTesting(false)
    }
  }

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

  const description =
    permission === 'unsupported'
      ? 'This browser cannot show system notifications here.'
      : permission === 'denied'
        ? 'Blocked by the browser. Allow notifications for this site in browser settings.'
        : permission === 'default'
          ? 'Turn this on to ask the browser for permission.'
          : `Show a system notification when a ${lowerSingular} needs you.`

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm">Desktop notifications</div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={desktopEnabled}
          onCheckedChange={(checked) => void toggleDesktop(checked)}
          disabled={!supported || permission === 'denied'}
          aria-label="Desktop notifications"
        />
      </div>

      {desktopEnabled && (
        <div className="pl-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void sendTest()}
            disabled={testing}
          >
            <Send className="size-3.5" /> Send test
          </Button>
        </div>
      )}

      {permission === 'unsupported' && (
        <p className="text-[11px] text-muted-foreground">
          System notifications need a secure browser context.
        </p>
      )}
    </>
  )
}

function PushNotificationsSetting({
  setPermission,
  isTouchDevice,
}: {
  setPermission: (permission: NotificationPermissionState) => void
  isTouchDevice: boolean
}) {
  const push = usePush()
  const { settings, update } = useNotificationSettings()

  const togglePush = async (enabled: boolean) => {
    if (enabled) await push.enable()
    else await push.disable()
    setPermission(readNotificationPermission())
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm">
            <Send className="size-3.5 text-muted-foreground" /> Push notifications
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {push.reason ?? 'Receive alerts when Clara is closed or in the background.'}
          </p>
          {push.error && <p className="mt-1 text-xs text-destructive">{push.error}</p>}
        </div>
        <Switch
          checked={push.enabled}
          onCheckedChange={(checked) => void togglePush(checked)}
          disabled={!push.available || push.busy || (push.isIosDevice && !push.isInstalled)}
          aria-label="Push notifications"
        />
      </div>

      {push.enabled && (
        <>
          <div className="flex flex-wrap items-center gap-2 pl-6">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void push.test()}
              disabled={push.busy}
            >
              <Send className="size-3.5" /> Send test
            </Button>
            {push.count !== null && (
              <span className="text-[11px] text-muted-foreground">
                {push.count} {push.count === 1 ? 'device' : 'devices'} registered
              </span>
            )}
          </div>

          {!isTouchDevice && (
            <div className="flex items-start justify-between gap-4 pl-6">
              <div className="min-w-0">
                <div className="text-xs">Hold phone alerts</div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Stop mobile pushes while this window is visible and you have been active.
                </p>
              </div>
              <Select
                value={String(settings.deskIdleMs)}
                onValueChange={(value) => update({ deskIdleMs: Number(value) })}
              >
                <SelectTrigger
                  size="sm"
                  className="w-[104px] shrink-0"
                  aria-label="Hold phone alerts after inactivity"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DESK_IDLE_OPTIONS_MS.map((ms) => (
                    <SelectItem key={ms} value={String(ms)}>
                      {ms / 60_000} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </>
      )}
    </>
  )
}
