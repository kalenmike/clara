import { PlugZap, QrCode } from 'lucide-react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

export type ConnectMode = 'pair' | 'direct'

const triggerClass =
  'group h-auto min-w-0 items-start justify-start gap-3 rounded-xl border-border bg-card px-3 py-3 text-left whitespace-normal text-muted-foreground shadow-none transition-colors hover:bg-muted/40 hover:text-foreground data-[state=active]:border-foreground/25 data-[state=active]:bg-muted/50 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:bg-card dark:data-[state=active]:bg-muted/50'

export function ModeSwitch() {
  return (
    <TabsList className="grid h-auto! w-full grid-cols-1 gap-2 bg-transparent p-0 sm:grid-cols-2">
      <TabsTrigger value="pair" className={triggerClass}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <QrCode className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">Pair this device</span>
          <span className="text-[11px] leading-snug font-normal text-muted-foreground">
            Scan the QR code or paste a pairing link.
          </span>
        </span>
      </TabsTrigger>
      <TabsTrigger value="direct" className={triggerClass}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <PlugZap className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">Connect directly</span>
          <span className="text-[11px] leading-snug font-normal text-muted-foreground">
            Use an OpenCode server URL without the relay.
          </span>
        </span>
      </TabsTrigger>
    </TabsList>
  )
}
