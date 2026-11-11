import {
  Cable,
  Gauge,
  LayoutDashboard,
  Radio,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

/**
 * The panel is a workbench, not a long report. Each tab owns one concern and
 * the rail mirrors the Clara Lab layout: primary views on top, settings below.
 */
export type PanelTab =
  'overview' | 'harness' | 'connections' | 'clients' | 'traffic' | 'activity' | 'settings'

export type PanelTabMeta = {
  id: PanelTab
  label: string
  icon: LucideIcon
  kicker: string
  title: string
  description: string
  /** Settings stays in the rail footer; every other tab sits in the main group. */
  primary: boolean
}

export const DEFAULT_PANEL_TAB: PanelTab = 'overview'

export const PANEL_TABS: PanelTabMeta[] = [
  {
    id: 'overview',
    label: 'Home',
    icon: LayoutDashboard,
    kicker: 'Hub',
    title: 'Overview',
    description: 'Live state of the hub, its harness, and the connections paired clients use.',
    primary: true,
  },
  {
    id: 'harness',
    label: 'Harness',
    icon: Cable,
    kicker: 'OpenCode',
    title: 'Harness',
    description: 'The OpenCode server this hub proxies to every paired client.',
    primary: true,
  },
  {
    id: 'connections',
    label: 'Network',
    icon: Radio,
    kicker: 'Transports',
    title: 'Connections',
    description: 'Loopback, relay, and push delivery. Each switch saves immediately.',
    primary: true,
  },
  {
    id: 'clients',
    label: 'Clients',
    icon: Users,
    kicker: 'Sessions',
    title: 'Clients',
    description: 'Live end-to-end encrypted sessions and the devices that own them.',
    primary: true,
  },
  {
    id: 'traffic',
    label: 'Traffic',
    icon: Gauge,
    kicker: 'Meter',
    title: 'Traffic',
    description: 'Bytes, requests, and errors through the hub over the last hour.',
    primary: true,
  },
  {
    id: 'activity',
    label: 'Activity',
    icon: ScrollText,
    kicker: 'Log',
    title: 'Activity',
    description: 'In-memory events and the files the hub service reads or writes.',
    primary: true,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    kicker: 'Control',
    title: 'Settings',
    description: 'Effective configuration, client sync, and the shell guardrail.',
    primary: false,
  },
]

export const PANEL_TAB_IDS: PanelTab[] = PANEL_TABS.map((tab) => tab.id)

const TAB_BY_ID = new Map(PANEL_TABS.map((tab) => [tab.id, tab]))

export function panelTabMeta(tab: PanelTab): PanelTabMeta {
  return TAB_BY_ID.get(tab) ?? TAB_BY_ID.get(DEFAULT_PANEL_TAB)!
}

/**
 * A hash link is the source of truth so a panel view can be bookmarked or sent
 * to another admin. Unknown or empty hashes fall back to Overview.
 */
export function panelTabFromHash(hash: string): PanelTab {
  const value = hash.startsWith('#') ? hash.slice(1) : hash
  const id = value.split(/[/?]/)[0]?.trim()
  if (!id) return DEFAULT_PANEL_TAB
  return isPanelTab(id) ? id : DEFAULT_PANEL_TAB
}

export function isPanelTab(value: string): value is PanelTab {
  return PANEL_TAB_IDS.includes(value as PanelTab)
}
