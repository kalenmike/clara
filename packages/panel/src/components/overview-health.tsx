import { Button } from '@clara/ui/components/button'
import {
  Bell,
  Cable,
  ChevronRight,
  CircleAlert,
  Cpu,
  Radio,
  Server,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { HealthItem } from '../lib/health.ts'
import type { PanelTab } from '../lib/tabs.ts'
import { usePeek } from '../lib/peek-context.tsx'

const ICONS: Record<HealthItem['key'], LucideIcon> = {
  hub: Server,
  harness: Cable,
  local: Cpu,
  relay: Radio,
  push: Bell,
  orchestration: Workflow,
}

export function HealthTiles({
  items,
  onSelect,
}: {
  items: HealthItem[]
  onSelect: (tab: PanelTab) => void
}) {
  const { redact } = usePeek()

  return (
    <div className="panel-health-grid">
      {items.map((item) => {
        const Icon = ICONS[item.key]
        const detail = redact(item.detail)
        return (
          <button
            key={item.key}
            type="button"
            className={`panel-health-tile tone-${item.tone}`}
            title={`${item.label}: ${detail}`}
            onClick={() => onSelect(item.tab)}
          >
            <span className="panel-health-icon">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span className="panel-health-copy">
              <span className="panel-health-label">{item.label}</span>
              <span className="panel-health-status">{item.status}</span>
              <span className="panel-health-detail">{detail}</span>
            </span>
            <ChevronRight className="panel-health-chevron size-3.5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export function AttentionBanner({
  items,
  onSelect,
}: {
  items: HealthItem[]
  onSelect: (tab: PanelTab) => void
}) {
  if (items.length === 0) return null
  const tone = items.some((item) => item.tone === 'bad') ? 'bad' : 'warn'

  return (
    <div className={`panel-banner ${tone}`} role="status">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        <strong>Needs attention.</strong>{' '}
        {items.map((item, index) => (
          <span key={item.key}>
            {index > 0 ? ' · ' : null}
            <Button
              type="button"
              variant="link"
              className="inline h-auto p-0 text-xs"
              onClick={() => onSelect(item.tab)}
            >
              {item.label}: {item.status}
            </Button>
          </span>
        ))}
      </span>
    </div>
  )
}
