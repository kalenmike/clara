import type { CompiledNode, Requirement } from '@clara/orchestration/types'

export type { CompiledNode, CompiledRoute } from '@clara/orchestration/types'

export interface AdapterInfo {
  id: string
  harness: string
  role?: string
  machine?: string | null
  labels?: string[]
  workspace?: string
  capabilities: string[]
  heartbeat_at?: string
}

export interface ResolvedWorkspace {
  workspace: string
  configPath: string
}

export interface ModelOption {
  providerID: string
  id: string
  name?: string
  enabled?: boolean
  type?: string
}

export interface PreviewInput {
  workspace?: string
  configPath?: string
  target?: string
  cwd?: string
  adapters?: AdapterInfo[]
  models?: ModelOption[]
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: DiagnosticSeverity
  code: string
  message: string
  path?: string
  stepPath?: string
}

export type TargetKind = 'entry' | 'pipeline'

export interface TargetInfo {
  ref: string
  label: string
  packageId: string
  packageName: string
  kind: TargetKind
  entryKind?: 'pipeline' | 'router'
  namespace?: string
  alias?: string
  description?: string
}

export interface PackageEntryInfo {
  id: string
  name: string
  version: number
  dir: string
  namespace?: string
  alias?: string
  entry: { pipeline?: string; router?: string }
  defaults?: Record<string, unknown>
  pipelines: Array<{ id: string; name: string; description?: string; source?: string }>
  routers: Array<{ id: string; description?: string; source?: string }>
  agents: Array<{ name: string; description?: string; source?: string }>
  scripts: Array<{ name: string; description?: string; source?: string }>
}

export type SourceKind = 'config' | 'package' | 'pipeline' | 'router' | 'agent' | 'script' | 'other'

export interface SourceRef {
  path: string
  kind: SourceKind
  packageId?: string
}

export interface CompiledPreview {
  root: CompiledNode
  hash: string
  sources: string[]
  /** The run snapshot the service would pin: the compiled root only. */
  snapshot: string
  /** The compile snapshot including package paths and source list. */
  fullSnapshot: string
}

export interface PreviewStats {
  nodes: number
  agents: number
  scripts: number
  routers: number
  groups: number
  pipelines: number
  routes: number
}

export interface PreviewResult {
  workspace?: ResolvedWorkspace
  catalog?: {
    configPath: string
    stdDir?: string
    packages: PackageEntryInfo[]
  }
  targets: TargetInfo[]
  selected?: TargetInfo
  compiled?: CompiledPreview
  diagnostics: Diagnostic[]
  sources: SourceRef[]
  stats?: PreviewStats
}

export interface NodeChange {
  path: string
  kind: 'added' | 'removed' | 'changed'
  fields: FieldChange[]
}

export interface FieldChange {
  field: string
  before: unknown
  after: unknown
}

export interface CompiledDiff {
  changes: NodeChange[]
  summary: {
    added: number
    removed: number
    changed: number
    unchanged: number
  }
}

export interface RouteDescriptor {
  when: string
  run: string
  criteria?: string
  description?: string
  target?: string
}

export interface RequirementInfo extends Requirement {
  adapter?: string
  runner?: string
  capabilities?: string[]
}
