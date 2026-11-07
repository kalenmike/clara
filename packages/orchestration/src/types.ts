import type { EnforcementMode, Limits, PermissionRule, StepPolicy } from '@clara/policy'

export type StepType = 'task' | 'pipeline' | 'router' | 'group'
export type RouterStrategy = 'llm_classify' | 'fixed'

export interface RouteDefinition {
  when: string
  run: string
  criteria?: string
  description?: string
}

export interface RetryPolicy {
  auto_attempts?: number
}

export interface NotificationPolicy {
  start?: boolean
  stage?: boolean
  success?: boolean
  failure?: boolean
  needs_input?: boolean
  retry?: boolean
  heartbeat?: boolean
}

export interface Requirement {
  adapter?: string
  capabilities?: string[]
}

export interface StepDefinition {
  name: string
  type: StepType
  title?: string
  description?: string
  prompt?: string
  task?: string
  ref?: string
  path?: string
  routes?: RouteDefinition[]
  strategy?: RouterStrategy
  steps?: StepDefinition[]
  background?: boolean
  model?: string
  permissions?: PermissionRule[]
  policy?: StepPolicy
  limits?: Limits
  retries?: RetryPolicy
  enforcement?: EnforcementMode
  requires?: Requirement
  source?: string
}

export interface PipelineDefinition {
  id: string
  name: string
  version?: number
  description?: string
  default_model?: string
  enforcement?: EnforcementMode
  policy?: StepPolicy
  limits?: Limits
  requires?: Requirement
  notification?: NotificationPolicy
  steps: StepDefinition[]
  source?: string
}

export interface RouterDefinition {
  id: string
  description?: string
  strategy?: RouterStrategy
  instructions: string
  routes: RouteDefinition[]
  permissions?: PermissionRule[]
  policy?: StepPolicy
  limits?: Limits
  enforcement?: EnforcementMode
  requires?: Requirement
  source?: string
}

export interface TaskDefinition {
  name: string
  description?: string
  prompt: string
  model?: string
  permissions?: PermissionRule[]
  policy?: StepPolicy
  limits?: Limits
  retries?: RetryPolicy
  source?: string
}

export interface ImportSpec {
  path: string
  as?: string
  select?: string[]
}

export interface PackageEntry {
  pipeline?: string
  router?: string
}

export interface PackageManifest {
  schemaVersion?: number
  id: string
  name: string
  version: number
  description?: string
  is_active?: boolean
  entry?: PackageEntry
  imports?: Record<string, Array<ImportSpec | string>>
  defaults?: {
    model?: string
    task_dir?: string
    enforcement?: EnforcementMode
    notification?: NotificationPolicy
  }
  router?: {
    path?: string
    id?: string
    strategy?: RouterStrategy
    routes?: RouteDefinition[]
  }
  pipelines?: Record<string, PipelineDefinition>
  source: string
}

export interface LoadedPackage {
  manifest: PackageManifest
  dir: string
  pipelines: Map<string, PipelineDefinition>
  routers: Map<string, RouterDefinition>
  tasks: Map<string, TaskDefinition>
  imports: Map<string, LoadedPackage[]>
  entry: PackageEntry
  sources: string[]
}

export interface LoadedCatalog {
  root: LoadedPackage
  packages: LoadedPackage[]
  configPath: string
  stdDir?: string
}

export interface CompiledRoute {
  when: string
  run: string
  criteria?: string
  description?: string
  target?: CompiledNode
}

export interface CompiledNode {
  path: string
  kind: StepType
  name: string
  title: string
  description?: string
  prompt?: string
  /** Where a task prompt came from, so previews can flag generated fallbacks. */
  promptSource?: 'step' | 'task' | 'description' | 'fallback' | 'router'
  /** Matched task file, when the step resolved through a task document. */
  task?: string
  model?: string
  policy?: StepPolicy
  limits?: Limits
  enforcement?: EnforcementMode
  requires?: Requirement
  background?: boolean
  retries?: RetryPolicy
  strategy?: RouterStrategy
  children?: CompiledNode[]
  routes?: CompiledRoute[]
  source?: string
  /** Package that owns this node's definition. */
  packageId?: string
  /** Fields declared directly on this node, as opposed to inherited defaults. */
  declared?: string[]
}

export interface CompiledRun {
  root: CompiledNode
  hash: string
  snapshot: string
  sources: string[]
  catalog: LoadedCatalog
}

export interface LoadError {
  path: string
  message: string
}
