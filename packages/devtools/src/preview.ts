import { resolve } from 'node:path'
import { compileRun, loadCatalog } from '@clara/orchestration/loader'
import type {
  CompiledNode,
  CompiledRun,
  LoadedCatalog,
  LoadedPackage,
} from '@clara/orchestration/types'
import { computeBudget } from '@clara/policy'
import type {
  AdapterInfo,
  CompiledPreview,
  Diagnostic,
  ModelOption,
  PackageEntryInfo,
  PreviewInput,
  PreviewResult,
  PreviewStats,
  SourceKind,
  SourceRef,
  TargetInfo,
} from './types.ts'
import { resolveWorkspace } from './workspace.ts'

const SOURCE_FIELDS = [
  'name',
  'title',
  'kind',
  'prompt',
  'promptSource',
  'task',
  'model',
  'provider',
  'enforcement',
  'background',
  'retries',
  'policy',
  'limits',
  'requires',
  'strategy',
  'source',
  'packageId',
  'declared',
] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorPath(error: unknown): string | undefined {
  return typeof (error as { path?: unknown }).path === 'string'
    ? String((error as { path: string }).path)
    : undefined
}

function directImports(catalog: LoadedCatalog): Map<string, { namespace: string; alias: string }> {
  const map = new Map<string, { namespace: string; alias: string }>()
  for (const [namespace, packages] of catalog.root.imports) {
    for (const pkg of packages) {
      map.set(pkg.dir, { namespace, alias: pkg.manifest.id })
    }
  }
  return map
}

export function listTargets(catalog: LoadedCatalog): TargetInfo[] {
  const targets: TargetInfo[] = []
  const seen = new Set<string>()
  const push = (target: TargetInfo): void => {
    if (seen.has(target.ref)) return
    seen.add(target.ref)
    targets.push(target)
  }

  const root = catalog.root
  if (root.entry.pipeline || root.entry.router) {
    push({
      ref: '',
      label: `${root.manifest.name} entry`,
      packageId: root.manifest.id,
      packageName: root.manifest.name,
      kind: 'entry',
      ...(root.entry.router
        ? { entryKind: 'router' as const }
        : { entryKind: 'pipeline' as const }),
    })
  }
  for (const pipeline of root.pipelines.values()) {
    push({
      ref: pipeline.id,
      label: pipeline.name,
      packageId: root.manifest.id,
      packageName: root.manifest.name,
      kind: 'pipeline',
      ...(pipeline.description ? { description: pipeline.description } : {}),
    })
  }

  for (const [namespace, packages] of root.imports) {
    for (const pkg of packages) {
      const alias = pkg.manifest.id
      if (pkg.entry.pipeline || pkg.entry.router) {
        push({
          ref: `${namespace}:${alias}`,
          label: `${namespace}:${alias} — ${pkg.manifest.name} entry`,
          packageId: pkg.manifest.id,
          packageName: pkg.manifest.name,
          kind: 'entry',
          namespace,
          alias,
          ...(pkg.entry.router
            ? { entryKind: 'router' as const }
            : { entryKind: 'pipeline' as const }),
        })
      }
      for (const pipeline of pkg.pipelines.values()) {
        push({
          ref: `${namespace}:${alias}/${pipeline.id}`,
          label: `${namespace}:${alias}/${pipeline.id} — ${pipeline.name}`,
          packageId: pkg.manifest.id,
          packageName: pkg.manifest.name,
          kind: 'pipeline',
          namespace,
          alias,
          ...(pipeline.description ? { description: pipeline.description } : {}),
        })
      }
    }
  }

  return targets
}

export function describePackages(catalog: LoadedCatalog): PackageEntryInfo[] {
  const direct = directImports(catalog)
  return catalog.packages.map((pkg: LoadedPackage) => {
    const imported = direct.get(pkg.dir)
    return {
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      dir: pkg.dir,
      ...(imported ? { namespace: imported.namespace, alias: imported.alias } : {}),
      entry: pkg.entry,
      ...(pkg.manifest.defaults
        ? { defaults: pkg.manifest.defaults as unknown as Record<string, unknown> }
        : {}),
      pipelines: [...pkg.pipelines.values()].map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        ...(pipeline.description ? { description: pipeline.description } : {}),
        ...(pipeline.source ? { source: pipeline.source } : {}),
      })),
      routers: [...pkg.routers.values()].map((router) => ({
        id: router.id,
        ...(router.description ? { description: router.description } : {}),
        ...(router.source ? { source: router.source } : {}),
      })),
      tasks: [...pkg.tasks.values()].map((task) => ({
        name: task.name,
        ...(task.description ? { description: task.description } : {}),
        ...(task.source ? { source: task.source } : {}),
      })),
    }
  })
}

function sourceKind(path: string, configPath: string): SourceKind {
  if (resolve(path) === resolve(configPath)) return 'config'
  if (/[/\\]pipelines[/\\]/.test(path)) return 'pipeline'
  if (/[/\\]routers[/\\]/.test(path)) return 'router'
  if (/[/\\]tasks[/\\]/.test(path)) return 'task'
  if (/index\.ya?ml$/.test(path)) return 'package'
  return 'other'
}

export function collectSources(catalog: LoadedCatalog, compiled?: CompiledRun): SourceRef[] {
  const byPath = new Map<string, SourceRef>()
  const add = (path: string, packageId?: string): void => {
    const normalized = resolve(path)
    if (byPath.has(normalized)) return
    byPath.set(normalized, {
      path: normalized,
      kind: sourceKind(normalized, catalog.configPath),
      ...(packageId ? { packageId } : {}),
    })
  }

  add(catalog.configPath, catalog.root.manifest.id)
  for (const pkg of catalog.packages) {
    for (const source of pkg.sources) add(source, pkg.manifest.id)
  }
  for (const source of compiled?.sources ?? []) add(source)
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

export function statsFor(root: CompiledNode): PreviewStats {
  const stats: PreviewStats = {
    nodes: 0,
    tasks: 0,
    routers: 0,
    groups: 0,
    pipelines: 0,
    routes: 0,
  }
  const walk = (node: CompiledNode): void => {
    stats.nodes++
    if (node.kind === 'task') stats.tasks++
    if (node.kind === 'router') stats.routers++
    if (node.kind === 'group') stats.groups++
    if (node.kind === 'pipeline') stats.pipelines++
    stats.routes += node.routes?.length ?? 0
    for (const child of node.children ?? []) walk(child)
    for (const route of node.routes ?? []) {
      if (route.target) walk(route.target)
    }
  }
  walk(root)
  return stats
}

interface WalkContext {
  parentKind?: CompiledNode['kind']
  seen: Set<string>
  adapters?: AdapterInfo[]
  models?: ModelOption[]
}

export function diagnoseCompiled(
  root: CompiledNode,
  adapters?: AdapterInfo[],
  models?: ModelOption[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const context: WalkContext = {
    seen: new Set(),
    ...(adapters ? { adapters } : {}),
    ...(models ? { models } : {}),
  }

  const walk = (node: CompiledNode, parentKind?: CompiledNode['kind']): void => {
    if (context.seen.has(node.path)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate_step_path',
        message: `Two compiled steps share the path "${node.path}".`,
        stepPath: node.path,
        ...(node.source ? { path: node.source } : {}),
      })
    }
    context.seen.add(node.path)

    const model = node.model?.trim()
    const provider = node.provider?.trim()
    const leaf = node.kind === 'task' || node.kind === 'router'
    if (leaf) {
      if (model && !provider) {
        diagnostics.push({
          severity: 'error',
          code: 'model_provider_missing',
          message: `Step "${node.name}" sets model "${model}" but no provider. Add provider or a package default provider.`,
          stepPath: node.path,
          ...(node.source ? { path: node.source } : {}),
        })
      } else if (!model && provider) {
        diagnostics.push({
          severity: 'warning',
          code: 'model_missing',
          message: `Step "${node.name}" sets provider "${provider}" but no model; the provider is ignored.`,
          stepPath: node.path,
          ...(node.source ? { path: node.source } : {}),
        })
      } else if (!model && !provider) {
        diagnostics.push({
          severity: 'warning',
          code: 'model_unset',
          message: `Step "${node.name}" has no model or provider; the worker will use the harness default instead of the pipeline.`,
          stepPath: node.path,
          ...(node.source ? { path: node.source } : {}),
        })
      } else if (model && provider && context.models) {
        const options = context.models
        const matches = options.filter((option) => option.id === model)
        const exact = matches.find((option) => option.providerID === provider)
        if (!exact) {
          const otherProviders = [...new Set(matches.map((option) => option.providerID))]
          diagnostics.push({
            severity: 'error',
            code: 'model_unknown',
            message: otherProviders.length
              ? `Step "${node.name}" uses ${provider}/${model}, but that model is only available under ${otherProviders.join(', ')}.`
              : `Step "${node.name}" uses ${provider}/${model}, which OpenCode does not report as an available model.`,
            stepPath: node.path,
            ...(node.source ? { path: node.source } : {}),
          })
        } else if (exact.enabled === false) {
          diagnostics.push({
            severity: 'warning',
            code: 'model_disabled',
            message: `Step "${node.name}" uses ${provider}/${model}, which is currently disabled in OpenCode.`,
            stepPath: node.path,
            ...(node.source ? { path: node.source } : {}),
          })
        }
      }
    }

    if (node.kind === 'task') {
      if (node.promptSource === 'fallback') {
        diagnostics.push({
          severity: 'warning',
          code: 'task_prompt_fallback',
          message: `Step "${node.name}" has no matching task file and no prompt; a generated prompt will be used.`,
          stepPath: node.path,
          ...(node.source ? { path: node.source } : {}),
        })
      }
      if (!node.prompt?.trim()) {
        diagnostics.push({
          severity: 'warning',
          code: 'empty_prompt',
          message: `Step "${node.name}" has an empty prompt.`,
          stepPath: node.path,
        })
      }
      if (node.background && parentKind !== 'pipeline' && parentKind !== 'group') {
        diagnostics.push({
          severity: 'warning',
          code: 'background_ignored',
          message: `Step "${node.name}" is marked background but only a pipeline or group honors it.`,
          stepPath: node.path,
        })
      }
    }

    if (node.kind === 'router') {
      if (!node.routes?.length) {
        diagnostics.push({
          severity: 'warning',
          code: 'router_without_routes',
          message: `Router "${node.name}" has no routes.`,
          stepPath: node.path,
          ...(node.source ? { path: node.source } : {}),
        })
      }
      const whens = new Set<string>()
      for (const route of node.routes ?? []) {
        if (whens.has(route.when)) {
          diagnostics.push({
            severity: 'warning',
            code: 'duplicate_route',
            message: `Router "${node.name}" declares the route "${route.when}" more than once.`,
            stepPath: node.path,
          })
        }
        whens.add(route.when)
        if (!route.criteria?.trim() && !route.description?.trim()) {
          diagnostics.push({
            severity: 'warning',
            code: 'route_without_criteria',
            message: `Route "${route.when}" in "${node.name}" has no criteria; the classifier sees only the route key.`,
            stepPath: node.path,
          })
        }
        if (!route.target) {
          diagnostics.push({
            severity: 'error',
            code: 'route_without_target',
            message: `Route "${route.when}" in "${node.name}" does not resolve to a pipeline.`,
            stepPath: node.path,
          })
        }
      }
    }

    if ((node.kind === 'pipeline' || node.kind === 'group') && !node.children?.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'empty_group',
        message: `"${node.name}" contains no steps.`,
        stepPath: node.path,
      })
    }

    if (node.retries?.auto_attempts !== undefined && node.retries.auto_attempts < 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'retries_invalid',
        message: `Step "${node.name}" sets retries.auto_attempts below 1.`,
        stepPath: node.path,
      })
    }

    const budget = computeBudget(node.limits, 1)
    if (node.limits && (budget.turns <= 0 || budget.tokens <= 0)) {
      diagnostics.push({
        severity: 'warning',
        code: 'empty_budget',
        message: `Step "${node.name}" resolves to a zero turn or token budget.`,
        stepPath: node.path,
      })
    }

    for (const child of node.children ?? []) walk(child, node.kind)
    for (const route of node.routes ?? []) {
      if (route.target) walk(route.target, 'router')
    }
  }

  walk(root)

  if (root.enforcement === 'strict') {
    const required = root.requires?.capabilities ?? ['tool_policy', 'turn_limit', 'token_limit']
    const harness = root.requires?.adapter
    const available =
      adapters?.some(
        (adapter) =>
          (!harness || adapter.harness === harness) &&
          required.every((capability) => adapter.capabilities.includes(capability))
      ) ?? false
    if (adapters && !available) {
      diagnostics.push({
        severity: 'warning',
        code: 'enforcement_unavailable',
        message: `This target is strict and needs a live ${
          harness ?? 'harness'
        } adapter with ${required.join(', ')}. Register the lab adapter before starting it.`,
      })
    }
  }

  return diagnostics
}

export function diagnoseCatalog(catalog: LoadedCatalog, target?: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  if (!catalog.root.entry.pipeline && !catalog.root.entry.router && !target) {
    diagnostics.push({
      severity: 'warning',
      code: 'entry_missing',
      message: `Package "${catalog.root.manifest.id}" has no entry. Pick a pipeline target instead.`,
      path: catalog.configPath,
    })
  }

  const byID = new Map<string, number>()
  for (const pkg of catalog.packages) {
    byID.set(pkg.manifest.id, (byID.get(pkg.manifest.id) ?? 0) + 1)
  }
  for (const [id, count] of byID) {
    if (count > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'duplicate_package_id',
        message: `${count} loaded packages use the id "${id}".`,
      })
    }
  }

  for (const pkg of catalog.packages) {
    if (!pkg.pipelines.size && !pkg.routers.size && !pkg.tasks.size) {
      diagnostics.push({
        severity: 'info',
        code: 'empty_package',
        message: `Package "${pkg.manifest.id}" has no pipelines, routers, or tasks.`,
        path: pkg.manifest.source,
      })
    }
  }

  return diagnostics
}

function compiledPreview(compiled: CompiledRun): CompiledPreview {
  return {
    root: compiled.root,
    hash: compiled.hash,
    sources: compiled.sources,
    snapshot: JSON.stringify(compiled.root),
    fullSnapshot: compiled.snapshot,
  }
}

export function previewPipeline(input: PreviewInput = {}): PreviewResult {
  const diagnostics: Diagnostic[] = []
  let workspace
  try {
    workspace = resolveWorkspace(input)
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'config_missing',
      message: errorMessage(error),
    })
    return { targets: [], diagnostics, sources: [] }
  }

  let catalog: LoadedCatalog
  try {
    catalog = loadCatalog(
      workspace.configPath,
      workspace.stdDir ? { stdDir: workspace.stdDir } : {}
    )
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'load_failed',
      message: errorMessage(error),
      ...(errorPath(error) ? { path: errorPath(error) as string } : { path: workspace.configPath }),
    })
    return {
      workspace,
      targets: [],
      diagnostics,
      sources: [{ path: workspace.configPath, kind: 'config' }],
    }
  }

  const targets = listTargets(catalog)
  const packages = describePackages(catalog)
  const requested = input.target?.trim() || undefined
  const selected = requested
    ? (targets.find((target) => target.ref === requested) ?? {
        ref: requested,
        label: requested,
        packageId: catalog.root.manifest.id,
        packageName: catalog.root.manifest.name,
        kind: 'pipeline' as const,
      })
    : targets.find((target) => target.ref === '')

  let compiled: CompiledRun | undefined
  try {
    compiled = compileRun(catalog, requested)
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: 'compile_failed',
      message: errorMessage(error),
      ...(errorPath(error) ? { path: errorPath(error) as string } : {}),
      ...(requested ? { stepPath: requested } : {}),
    })
  }

  diagnostics.push(...diagnoseCatalog(catalog, requested))
  if (compiled) {
    diagnostics.push(...diagnoseCompiled(compiled.root, input.adapters, input.models))
  }

  return {
    workspace,
    catalog: {
      configPath: catalog.configPath,
      ...(catalog.stdDir ? { stdDir: catalog.stdDir } : {}),
      packages,
    },
    targets,
    ...(selected ? { selected } : {}),
    ...(compiled ? { compiled: compiledPreview(compiled), stats: statsFor(compiled.root) } : {}),
    diagnostics,
    sources: collectSources(catalog, compiled),
  }
}

export const COMPARED_FIELDS = SOURCE_FIELDS
