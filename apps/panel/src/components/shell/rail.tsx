import { PANEL_TABS, type PanelTab, type PanelTabMeta } from '../../lib/tabs.ts'

export type RailBadge = {
  count?: number
  tone?: 'warn' | 'bad'
}

export function Rail({
  active,
  onSelect,
  badges,
}: {
  active: PanelTab
  onSelect: (tab: PanelTab) => void
  badges: Partial<Record<PanelTab, RailBadge>>
}) {
  const primary = PANEL_TABS.filter((tab) => tab.primary)
  const settings = PANEL_TABS.find((tab) => tab.id === 'settings')

  return (
    <nav className="panel-rail" aria-label="Panel views">
      <div className="panel-rail-brand" aria-hidden="true">
        C
      </div>
      <div className="panel-rail-items">
        {primary.map((item) => (
          <RailItem
            key={item.id}
            item={item}
            active={active === item.id}
            badge={badges[item.id]}
            onSelect={onSelect}
          />
        ))}
      </div>
      {settings ? (
        <div className="panel-rail-footer">
          <RailItem
            item={settings}
            active={active === settings.id}
            badge={badges[settings.id]}
            onSelect={onSelect}
          />
        </div>
      ) : null}
    </nav>
  )
}

function RailItem({
  item,
  active,
  badge,
  onSelect,
}: {
  item: PanelTabMeta
  active: boolean
  badge?: RailBadge
  onSelect: (tab: PanelTab) => void
}) {
  const Icon = item.icon
  const className = [
    'panel-rail-item',
    active ? 'active' : '',
    badge?.tone === 'bad' ? 'bad' : badge?.tone === 'warn' ? 'warn' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={className}
      aria-current={active ? 'page' : undefined}
      aria-label={item.title}
      title={item.title}
      onClick={() => onSelect(item.id)}
    >
      <span className="panel-rail-icon">
        <Icon size={19} aria-hidden="true" />
      </span>
      <span className="panel-rail-label">{item.label}</span>
      {badge?.count !== undefined ? (
        <span className="panel-rail-count">{badge.count}</span>
      ) : badge?.tone ? (
        <span className="panel-rail-dot" aria-hidden="true" />
      ) : null}
    </button>
  )
}
