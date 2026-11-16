import type { EnforcementMode, Limits, PermissionRule, StepPolicy } from '@clara/policy'

export type StepType = 'agent' | 'script' | 'pipeline' | 'router' | 'group'
export type RouterStrategy = 'llm_classify' | 'fixed'
export type ScriptResultMode = 'auto' | 'json' | 'text' | 'exit' | 'tail'

/** The deterministic payload of a script step. */
export interface ScriptSpec {
  command: string
  interpreter?: string
  /** Workspace-relative working directory. Defaults to the run workspace. */
  cwd?: string
  env?: Record<string, string>
  /** Runner environment variables to forward to the process. */
  passEnv?: string[]
  timeoutSeconds?: number
  successCodes?: number[]
  resultMode?: ScriptResultMode
  maxOutputBytes?: number
}

export interface RouteDefinition {
  when: string
  run: string
  criteria?: string
  description?: string
}

export interface RetryPolicy {
  auto_attempts?: number
}

/** A bounded recovery branch that runs after a step exhausts its retries. */
export interface OnFailureDefinition {
  /** Recovery cycles allowed for this step. Defaults to 1. */
  max_cycles?: number
  /** Retry the failed step after a successful recovery. Defaults to true. */
  retry?: boolean
  steps: StepDefinition[]
}

export interface CompiledRecovery {
  maxCycles: number
  retry: boolean
  children: CompiledNode[]
}

/**
 * A wrapper resolves a dynamic workspace from an earlier step result. The
 * wrapper's `before` steps run in the parent workspace; its body and `after`
 * steps run in the resolved directory.
 */
export interface WorkspaceBinding {
  /** Name of a step in the wrapper's `before` list. */
  from: string
  /** Result field that carries the path. Defaults to `path`. */
  field?: string
}

export interface CompiledWorkspaceBinding {
  /** Compiled path of the step that produces the workspace path. */
  path: string
  field: string
}

/** A reusable before/after guard compiled around a router's chosen target. */
export interface WrapperDefinition {
  id: string
  name?: string
  description?: string
  workspace?: WorkspaceBinding
  before: StepDefinition[]
  after: StepDefinition[]
  cleanup: StepDefinition[]
  source?: string
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
  /** Named runner (id or label) required by a script step. */
  runner?: string
  capabilities?: string[]
}

export interface StepDefinition {
  name: string
  type: StepType
  title?: string
  description?: string
  prompt?: string
  /** Agent document selected by an agent step. Defaults to the step name. */
  agent?: string
  /** Named script document selected by a script step. */
  script?: string
  /** Inline command for a script step. Mutually exclusive with `script`. */
  command?: string
  interpreter?: string
  cwd?: string
  env?: Record<string, string>
  pass_env?: string[]
  timeout_seconds?: number
  success_codes?: number[]
  result_mode?: ScriptResultMode
  max_output_bytes?: number
  ref?: string
  path?: string
  /** label -> earlier sibling step name, resolved to a compiled path. */
  inputs?: Record<string, string>
  /** label -> workspace-relative path or glob the step reads itself. */
  artifacts?: Record<string, string>
  /** Whether the worker prompt includes the root request as background. */
  request?: boolean
  routes?: RouteDefinition[]
  strategy?: RouterStrategy
  steps?: StepDefinition[]
  background?: boolean
  model?: string
  provider?: string
  permissions?: PermissionRule[]
  policy?: StepPolicy
  limits?: Limits
  retries?: RetryPolicy
  on_failure?: OnFailureDefinition
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
  default_provider?: string
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

export interface AgentDefinition {
  name: string
  description?: string
  prompt: string
  model?: string
  provider?: string
  permissions?: PermissionRule[]
  policy?: StepPolicy
  limits?: Limits
  retries?: RetryPolicy
  source?: string
}

/** A reusable deterministic command, discovered from a package's `scripts/`. */
export interface ScriptDefinition {
  name: string
  description?: string
  command: string
  interpreter?: string
  cwd?: string
  env?: Record<string, string>
  passEnv?: string[]
  timeoutSeconds?: number
  successCodes?: number[]
  resultMode?: ScriptResultMode
  maxOutputBytes?: number
  source?: string
}

export interface ImportSpec {
  path: string
  select?: string[]
  /**
   * Wrapper applied when a router in another package selects this package.
   * The reference resolves against the importing package.
   */
  wrap?: string
}

/** Model and provider selected by the workspace, a package, or a step. */
export interface ModelSelection {
  model?: string
  provider?: string
}

export interface PackageOverrides {
  /** Replaces the imported package's defaults. */
  defaults?: ModelSelection
  /** Replaces pipeline-level defaults by pipeline id. */
  pipelines?: Record<string, { default_model?: string; default_provider?: string }>
  /** Replaces agent frontmatter by agent name. */
  agents?: Record<string, ModelSelection>
}

/** Workspace-level overrides keyed by an import ref such as `std:software`. */
export type WorkspaceOverrides = Record<string, PackageOverrides>

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
    provider?: string
    agent_dir?: string
    script_dir?: string
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
  wrappers?: Record<string, WrapperDefinition>
  source: string
}

export interface LoadedPackage {
  manifest: PackageManifest
  dir: string
  pipelines: Map<string, PipelineDefinition>
  routers: Map<string, RouterDefinition>
  agents: Map<string, AgentDefinition>
  scripts: Map<string, ScriptDefinition>
  wrappers: Map<string, WrapperDefinition>
  imports: Map<string, LoadedPackage[]>
  entry: PackageEntry
  /** Import-level wrapper applied when another package's router selects this one. */
  wrap?: string
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
  /** Where an agent prompt came from, so previews can flag generated fallbacks. */
  promptSource?: 'step' | 'agent' | 'description' | 'fallback' | 'router'
  /** Matched agent document, when the step resolved through an agent file. */
  agent?: string
  /** Deterministic payload for a script step. */
  script?: ScriptSpec
  model?: string
  provider?: string
  policy?: StepPolicy
  limits?: Limits
  enforcement?: EnforcementMode
  requires?: Requirement
  background?: boolean
  retries?: RetryPolicy
  /** label -> resolved compiled step path. */
  inputs?: Record<string, string>
  /** label -> workspace-relative path or glob. */
  artifacts?: Record<string, string>
  /** Whether the worker prompt includes the root request as background. */
  request?: boolean
  strategy?: RouterStrategy
  /** Set on a wrapper scope container: resolve its workspace from an earlier step. */
  workspace?: CompiledWorkspaceBinding
  /**
   * Nearest enclosing workspace scope. Every leaf below a scope carries it so a
   * work order can find the resolved directory without walking the tree.
   */
  scopePath?: string
  children?: CompiledNode[]
  routes?: CompiledRoute[]
  /** Recovery branch for a leaf step. Absent on containers and recovery steps. */
  onFailure?: CompiledRecovery
  /** Set on a recovery step: the path of the step whose failure it handles. */
  recoveryFor?: string
  source?: string
  /** Package that owns this node's definition. */
  packageId?: string
  /** Fields declared directly on this node, as opposed to inherited defaults. */
  declared?: string[]
  /**
   * Preview-only placeholder for the pipeline a wrapper receives at runtime.
   * `compileRun` never sets this.
   */
  slot?: boolean
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
