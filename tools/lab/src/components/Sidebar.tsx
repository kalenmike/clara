import type { LabTab } from '../lib/settings'
import { Icon, type IconName } from './Icon'

interface NavItem {
  id: LabTab
  label: string
  icon: IconName
  count?: number
  warn?: boolean
}

export function Sidebar({
  tab,
  onTab,
  workCount,
  callCount,
  setupIssues,
}: {
  tab: LabTab
  onTab: (tab: LabTab) => void
  workCount: number
  callCount: number
  setupIssues: number
}) {
  const primary: NavItem[] = [
    { id: 'pipeline', label: 'Review', icon: 'review' },
    { id: 'runs', label: 'Runs', icon: 'runs', count: workCount },
    { id: 'traffic', label: 'Traffic', icon: 'traffic', count: callCount },
    { id: 'console', label: 'Console', icon: 'console' },
  ]

  return (
    <nav className="rail" aria-label="Clara Lab views">
      <div className="rail-brand" aria-hidden="true">
        C
      </div>
      <div className="rail-items">
        {primary.map((item) => (
          <RailItem key={item.id} item={item} active={tab === item.id} onSelect={onTab} />
        ))}
      </div>
      <div className="rail-footer">
        <RailItem
          item={{
            id: 'settings',
            label: 'Settings',
            icon: 'settings',
            count: setupIssues || undefined,
            warn: setupIssues > 0,
          }}
          active={tab === 'settings'}
          onSelect={onTab}
        />
      </div>
    </nav>
  )
}

function RailItem({
  item,
  active,
  onSelect,
}: {
  item: NavItem
  active: boolean
  onSelect: (tab: LabTab) => void
}) {
  return (
    <button
      type="button"
      className={`rail-item ${active ? 'active' : ''} ${item.warn ? 'warn' : ''}`}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      onClick={() => onSelect(item.id)}
    >
      <span className="rail-icon">
        <Icon name={item.icon} size={19} />
      </span>
      <span className="rail-label">{item.label}</span>
      {item.count ? <span className="rail-count">{item.count}</span> : null}
    </button>
  )
}
