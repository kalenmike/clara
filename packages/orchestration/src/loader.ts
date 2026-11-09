import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Limits, PermissionRule, StepPolicy } from '@clara/policy'
import { parseMarkdownDocument, parseYamlRecord } from './frontmatter.ts'
import type {
  CompiledNode,
  CompiledRoute,
  CompiledRun,
  ImportSpec,
  LoadedCatalog,
  LoadedPackage,
  ModelSelection,
  PackageEntry,
  PackageManifest,
  PackageOverrides,
  PipelineDefinition,
  RouteDefinition,
  RouterDefinition,
  StepDefinition,
  TaskDefinition,
  WorkspaceOverrides,
} from './types.ts'

export interface LoadOptions {
  stdDir?: string
  maxImportDepth?: number
}

export class OrchestrationError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'OrchestrationError'
    this.path = path
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeEntry(value: unknown, path: string): PackageEntry {
  if (value === undefined) return {}
  if (typeof value === 'string') {
    if (!value.trim()) throw new OrchestrationError(path, 'entry must not be empty')
    return { pipeline: value }
  }
  if (!isRecord(value)) throw new OrchestrationError(path, 'entry must be a string or object')
  const pipeline = str(value.pipeline)
  const router = str(value.router)
  if (!pipeline && !router) throw new OrchestrationError(path, 'entry needs pipeline or router')
  return { ...(pipeline ? { pipeline } : {}), ...(router ? { router } : {}) }
}

function normalizeImports(
  value: unknown,
  path: string
): Record<string, Array<ImportSpec | string>> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new OrchestrationError(path, 'imports must be an object')
  const result: Record<string, Array<ImportSpec | string>> = {}
  for (const [namespace, raw] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(namespace)) {
      throw new OrchestrationError(path, `import namespace "${namespace}" is invalid`)
    }
    result[namespace] = list(raw).map((item) => {
      if (typeof item === 'string') return item
      if (!isRecord(item)) throw new OrchestrationError(path, `imports.${namespace}: invalid entry`)
      const entryPath = str(item.path)
      if (!entryPath) throw new OrchestrationError(path, `imports.${namespace}: path is required`)
      return {
        path: entryPath,
        ...(str(item.as) ? { as: String(item.as) } : {}),
        ...(Array.isArray(item.select)
          ? { select: item.select.filter((name): name is string => typeof name === 'string') }
          : {}),
      }
    })
  }
  return result
}

function optionalString(
  raw: Record<string, unknown>,
  key: string,
  source: string,
  path: string
): string | undefined {
  if (!(key in raw)) return undefined
  const value = str(raw[key])
  if (!value) throw new OrchestrationError(source, `${path}.${key} must be a non-empty string`)
  return value
}

function assertKnownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  source: string,
  path: string
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new OrchestrationError(source, `${path}.${key} is not supported`)
    }
  }
}

function normalizeModelSelection(
  raw: Record<string, unknown>,
  source: string,
  path: string
): ModelSelection {
  assertKnownKeys(raw, ['model', 'provider'], source, path)
  return {
    ...(optionalString(raw, 'model', source, path) ? { model: String(raw.model) } : {}),
    ...(optionalString(raw, 'provider', source, path) ? { provider: String(raw.provider) } : {}),
  }
}

function normalizeOverrides(value: unknown, source: string): WorkspaceOverrides {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new OrchestrationError(source, 'overrides must be an object')
  const result: WorkspaceOverrides = {}
  for (const [ref, raw] of Object.entries(value)) {
    const path = `overrides.${ref}`
    const parsed = parseRef(ref)
    if (!parsed.namespace || parsed.pipeline) {
      throw new OrchestrationError(
        source,
        `${path} must be namespace:package, for example std:software`
      )
    }
    if (!isRecord(raw)) throw new OrchestrationError(source, `${path} must be an object`)
    assertKnownKeys(raw, ['defaults', 'pipelines', 'tasks'], source, path)
    const override: PackageOverrides = {}
    if (raw.defaults !== undefined) {
      if (!isRecord(raw.defaults)) {
        throw new OrchestrationError(source, `${path}.defaults must be an object`)
      }
      override.defaults = normalizeModelSelection(raw.defaults, source, `${path}.defaults`)
    }
    if (raw.pipelines !== undefined) {
      if (!isRecord(raw.pipelines)) {
        throw new OrchestrationError(source, `${path}.pipelines must be an object`)
      }
      override.pipelines = {}
      for (const [id, patch] of Object.entries(raw.pipelines)) {
        const pipelinePath = `${path}.pipelines.${id}`
        if (!isRecord(patch)) {
          throw new OrchestrationError(source, `${pipelinePath} must be an object`)
        }
        assertKnownKeys(patch, ['default_model', 'default_provider'], source, pipelinePath)
        override.pipelines[id] = {
          ...(optionalString(patch, 'default_model', source, pipelinePath)
            ? { default_model: String(patch.default_model) }
            : {}),
          ...(optionalString(patch, 'default_provider', source, pipelinePath)
            ? { default_provider: String(patch.default_provider) }
            : {}),
        }
      }
    }
    if (raw.tasks !== undefined) {
      if (!isRecord(raw.tasks)) {
        throw new OrchestrationError(source, `${path}.tasks must be an object`)
      }
      override.tasks = {}
      for (const [name, patch] of Object.entries(raw.tasks)) {
        const taskPath = `${path}.tasks.${name}`
        if (!isRecord(patch)) {
          throw new OrchestrationError(source, `${taskPath} must be an object`)
        }
        override.tasks[name] = normalizeModelSelection(patch, source, taskPath)
      }
    }
    result[ref] = override
  }
  return result
}

function normalizeManifest(raw: Record<string, unknown>, source: string): PackageManifest {
  const id = str(raw.id) ?? basename(dirname(source))
  if (!id) throw new OrchestrationError(source, 'id is required')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new OrchestrationError(source, 'id must be lowercase letters, digits, and dashes')
  }
  const name = str(raw.name) ?? id
  const version = num(raw.version) ?? 1
  if (!Number.isInteger(version) || version < 1) {
    throw new OrchestrationError(source, 'version must be a positive integer')
  }
  const defaults = isRecord(raw.defaults) ? raw.defaults : {}
  const defaultModel = str(defaults.model) ?? str(raw.default_model)
  const defaultProvider = str(defaults.provider) ?? str(raw.default_provider)
  const router = isRecord(raw.router)
    ? {
        ...(str(raw.router.path) ? { path: String(raw.router.path) } : {}),
        ...(str(raw.router.id) ? { id: String(raw.router.id) } : {}),
        ...(str(raw.router.strategy)
          ? { strategy: String(raw.router.strategy) as RouterDefinition['strategy'] }
          : {}),
        ...(Array.isArray(raw.router.routes) ? { routes: normalizeRoutes(raw.router.routes) } : {}),
      }
    : undefined

  return {
    schemaVersion: num(raw.schemaVersion),
    id,
    name,
    version,
    ...(str(raw.description) ? { description: String(raw.description) } : {}),
    ...(bool(raw.is_active) !== undefined ? { is_active: Boolean(raw.is_active) } : {}),
    ...(raw.entry !== undefined ? { entry: normalizeEntry(raw.entry, source) } : {}),
    imports: normalizeImports(raw.imports, source),
    ...(defaultModel || defaultProvider || Object.keys(defaults).length
      ? {
          defaults: {
            ...(defaultModel ? { model: defaultModel } : {}),
            ...(defaultProvider ? { provider: defaultProvider } : {}),
            ...(str(defaults.task_dir) ? { task_dir: String(defaults.task_dir) } : {}),
            ...(str(defaults.enforcement)
              ? {
                  enforcement: String(defaults.enforcement) as NonNullable<
                    PackageManifest['defaults']
                  >['enforcement'],
                }
              : {}),
          },
        }
      : {}),
    ...(router ? { router } : {}),
    ...(isRecord(raw.pipelines)
      ? { pipelines: raw.pipelines as Record<string, PipelineDefinition> }
      : {}),
    source,
  }
}

function normalizeRoutes(value: unknown): RouteDefinition[] {
  return list(value).flatMap((item) => {
    if (!isRecord(item)) return []
    const when = str(item.when) ?? str(item.route)
    const run = str(item.run)
    if (!when || !run) return []
    return [
      {
        when,
        run,
        ...(str(item.criteria) ? { criteria: String(item.criteria) } : {}),
        ...(str(item.description) ? { description: String(item.description) } : {}),
      },
    ]
  })
}

function renderRouteList(routes: RouteDefinition[]): string {
  return routes
    .map((route) => {
      const criteria = (route.criteria ?? route.description)?.replace(/\s+/g, ' ').trim()
      return criteria ? `- \`${route.when}\` — ${criteria}` : `- \`${route.when}\``
    })
    .join('\n')
}

function renderRouterPrompt(instructions: string, routes: RouteDefinition[]): string {
  const list = renderRouteList(routes)
  if (!list) return instructions
  if (instructions.includes('[ROUTES]')) {
    return instructions.split('[ROUTES]').join(list)
  }
  return instructions.trim()
    ? `${instructions.trimEnd()}\n\n## Routes\n\n${list}`
    : `## Routes\n\n${list}`
}

function normalizeWiring(
  value: unknown,
  field: string,
  source: string
): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const result: Record<string, string> = {}
  const add = (label: string, target: string): void => {
    const name = label.trim()
    if (!name) throw new OrchestrationError(source, `${field} has an empty label`)
    const ref = target.trim()
    if (!ref) throw new OrchestrationError(source, `${field}.${name} is empty`)
    if (result[name] !== undefined)
      throw new OrchestrationError(source, `${field}.${name} is declared twice`)
    result[name] = ref
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string' || !item.trim())
        throw new OrchestrationError(source, `${field} entries must be non-empty strings`)
      add(item, item)
    }
    return result
  }
  if (isRecord(value)) {
    for (const [label, item] of Object.entries(value)) {
      if (typeof item !== 'string')
        throw new OrchestrationError(source, `${field}.${label} must be a step name or path`)
      add(label, item)
    }
    return result
  }
  throw new OrchestrationError(source, `${field} must be a list or a mapping`)
}

function normalizeStep(raw: unknown, source: string, index: number): StepDefinition {
  if (!isRecord(raw)) throw new OrchestrationError(source, `steps[${index}] must be an object`)
  const name = str(raw.name) ?? str(raw.id)
  if (!name) throw new OrchestrationError(source, `steps[${index}].name is required`)
  const type = (str(raw.type) ?? (raw.steps ? 'group' : 'task')) as StepDefinition['type']
  if (!['task', 'pipeline', 'router', 'group'].includes(type)) {
    throw new OrchestrationError(source, `steps[${index}].type is invalid`)
  }
  const inputs = normalizeWiring(raw.inputs, `steps[${index}].inputs`, source)
  const artifacts = normalizeWiring(raw.artifacts, `steps[${index}].artifacts`, source)
  return {
    name,
    type,
    ...(str(raw.title) ? { title: String(raw.title) } : {}),
    ...(str(raw.description) ? { description: String(raw.description) } : {}),
    ...(str(raw.prompt) ? { prompt: String(raw.prompt) } : {}),
    ...(str(raw.task) ? { task: String(raw.task) } : {}),
    ...(str(raw.ref) ? { ref: String(raw.ref) } : {}),
    ...(str(raw.path) ? { path: String(raw.path) } : {}),
    ...(inputs ? { inputs } : {}),
    ...(artifacts ? { artifacts } : {}),
    ...(bool(raw.request) !== undefined ? { request: Boolean(raw.request) } : {}),
    ...(Array.isArray(raw.routes) ? { routes: normalizeRoutes(raw.routes) } : {}),
    ...(str(raw.strategy) ? { strategy: String(raw.strategy) as StepDefinition['strategy'] } : {}),
    ...(Array.isArray(raw.steps)
      ? { steps: raw.steps.map((step, child) => normalizeStep(step, source, child)) }
      : {}),
    ...(bool(raw.background) !== undefined ? { background: Boolean(raw.background) } : {}),
    ...(str(raw.model) ? { model: String(raw.model) } : {}),
    ...(str(raw.provider) ? { provider: String(raw.provider) } : {}),
    ...(Array.isArray(raw.permissions) ? { permissions: raw.permissions as PermissionRule[] } : {}),
    ...(isRecord(raw.policy) ? { policy: raw.policy as StepPolicy } : {}),
    ...(isRecord(raw.limits) ? { limits: raw.limits as Limits } : {}),
    ...(isRecord(raw.retries) ? { retries: raw.retries as { auto_attempts?: number } } : {}),
    ...(str(raw.enforcement)
      ? { enforcement: String(raw.enforcement) as StepDefinition['enforcement'] }
      : {}),
    ...(isRecord(raw.requires)
      ? {
          requires: {
            ...(str(raw.requires.adapter) ? { adapter: String(raw.requires.adapter) } : {}),
            ...(Array.isArray(raw.requires.capabilities)
              ? {
                  capabilities: raw.requires.capabilities.filter(
                    (item): item is string => typeof item === 'string'
                  ),
                }
              : {}),
          },
        }
      : {}),
  }
}

function normalizePipeline(
  raw: Record<string, unknown>,
  id: string,
  source: string
): PipelineDefinition {
  const steps = list(raw.steps).map((step, index) => normalizeStep(step, source, index))
  if (!steps.length) throw new OrchestrationError(source, `pipeline ${id} has no steps`)
  return {
    id,
    name: str(raw.name) ?? id,
    version: num(raw.version) ?? 1,
    ...(str(raw.description) ? { description: String(raw.description) } : {}),
    ...(str(raw.default_model) ? { default_model: String(raw.default_model) } : {}),
    ...(str(raw.default_provider) ? { default_provider: String(raw.default_provider) } : {}),
    ...(str(raw.enforcement)
      ? { enforcement: String(raw.enforcement) as PipelineDefinition['enforcement'] }
      : {}),
    ...(isRecord(raw.policy) ? { policy: raw.policy as StepPolicy } : {}),
    ...(isRecord(raw.limits) ? { limits: raw.limits as Limits } : {}),
    ...(isRecord(raw.requires) ? { requires: raw.requires as PipelineDefinition['requires'] } : {}),
    ...(isRecord(raw.notification)
      ? { notification: raw.notification as PipelineDefinition['notification'] }
      : {}),
    steps,
    source,
  }
}

function loadPipelineFile(path: string): Map<string, PipelineDefinition> {
  const raw = parseYamlRecord(readFileSync(path, 'utf8'), path)
  const pipelines = new Map<string, PipelineDefinition>()
  if (isRecord(raw.pipelines)) {
    for (const [id, definition] of Object.entries(raw.pipelines)) {
      if (!isRecord(definition))
        throw new OrchestrationError(path, `pipelines.${id} must be an object`)
      pipelines.set(id, normalizePipeline(definition, id, path))
    }
    return pipelines
  }
  const id = str(raw.id)
  if (!id) throw new OrchestrationError(path, 'pipeline file needs id or a pipelines map')
  pipelines.set(id, normalizePipeline(raw, id, path))
  return pipelines
}

function loadRouterFile(path: string): RouterDefinition {
  const document = parseMarkdownDocument(readFileSync(path, 'utf8'), path)
  const data = document.data
  const id = str(data.id) ?? basename(path, extname(path))
  return {
    id,
    ...(str(data.description) ? { description: String(data.description) } : {}),
    ...(str(data.strategy)
      ? { strategy: String(data.strategy) as RouterDefinition['strategy'] }
      : {}),
    instructions: document.body,
    routes: normalizeRoutes(data.routes),
    ...(Array.isArray(data.permissions)
      ? { permissions: data.permissions as PermissionRule[] }
      : {}),
    ...(isRecord(data.policy) ? { policy: data.policy as StepPolicy } : {}),
    ...(isRecord(data.limits) ? { limits: data.limits as Limits } : {}),
    ...(str(data.enforcement)
      ? { enforcement: String(data.enforcement) as RouterDefinition['enforcement'] }
      : {}),
    ...(isRecord(data.requires) ? { requires: data.requires as RouterDefinition['requires'] } : {}),
    source: path,
  }
}

function loadTaskFile(path: string, taskRoot: string): TaskDefinition {
  const document = parseMarkdownDocument(readFileSync(path, 'utf8'), path)
  const data = document.data
  const relativePath = relative(taskRoot, path).replace(/\\/g, '/')
  const name = str(data.id) ?? relativePath.replace(/\.(md|markdown)$/i, '')
  return {
    name,
    ...(str(data.description) ? { description: String(data.description) } : {}),
    prompt: document.body,
    ...(str(data.model) ? { model: String(data.model) } : {}),
    ...(str(data.provider) ? { provider: String(data.provider) } : {}),
    ...(Array.isArray(data.permissions)
      ? { permissions: data.permissions as PermissionRule[] }
      : {}),
    ...(isRecord(data.policy) ? { policy: data.policy as StepPolicy } : {}),
    ...(isRecord(data.limits) ? { limits: data.limits as Limits } : {}),
    ...(isRecord(data.retries) ? { retries: data.retries as TaskDefinition['retries'] } : {}),
    source: path,
  }
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .sort()
    .map((file) => join(dir, file))
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((file) => file.endsWith('.md') || file.endsWith('.markdown'))
    .sort()
    .map((file) => join(dir, file))
}

function indexPath(path: string): string {
  if (existsSync(path) && statSync(path).isDirectory()) {
    for (const name of ['index.yml', 'index.yaml']) {
      const candidate = join(path, name)
      if (existsSync(candidate)) return candidate
    }
    throw new OrchestrationError(path, 'no index.yml or index.yaml')
  }
  return path
}

function findStdDir(configDir: string): string | undefined {
  const configured = process.env.CLARA_STD_DIR?.trim()
  if (configured) return resolve(configured)
  let current = resolve(configDir)
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, 'lib', 'std')
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return
}

function resolveImportPath(
  namespace: string,
  spec: string,
  fromDir: string,
  stdDir: string | undefined
): string {
  if (isAbsolute(spec)) return spec
  if (spec.startsWith('./') || spec.startsWith('../')) return resolve(fromDir, spec)
  if (namespace === 'std' && stdDir) return resolve(stdDir, spec)
  return resolve(fromDir, spec)
}

function syntheticPackage(path: string, spec: ImportSpec): LoadedPackage {
  const raw = parseYamlRecord(readFileSync(path, 'utf8'), path)
  const id = str(raw.id) ?? basename(path, extname(path))
  const pipelines = loadPipelineFile(path)
  const names = spec.select?.length ? new Set(spec.select) : undefined
  const selected = new Map([...pipelines].filter(([name]) => !names || names.has(name)))
  const manifest: PackageManifest = {
    id,
    name: str(raw.name) ?? id,
    version: num(raw.version) ?? 1,
    source: path,
  }
  return {
    manifest,
    dir: dirname(path),
    pipelines: selected,
    routers: new Map(),
    tasks: new Map(),
    imports: new Map(),
    entry: { pipeline: selected.keys().next().value as string | undefined },
    sources: [path],
  }
}

function loadPackageDirectory(
  directory: string,
  options: LoadOptions,
  stdDir: string | undefined,
  stack: Set<string>,
  depth: number
): LoadedPackage {
  const index = indexPath(directory)
  const manifest = normalizeManifest(parseYamlRecord(readFileSync(index, 'utf8'), index), index)
  if (manifest.is_active === false) {
    throw new OrchestrationError(index, `package ${manifest.id} is not active`)
  }
  const dir = dirname(index)
  const key = resolve(dir)
  if (stack.has(key)) throw new OrchestrationError(index, 'package import cycle detected')
  if (depth > (options.maxImportDepth ?? 8)) {
    throw new OrchestrationError(index, 'package import depth exceeded')
  }
  stack.add(key)

  const routers = new Map<string, RouterDefinition>()
  for (const file of markdownFiles(join(dir, 'routers'))) {
    const router = loadRouterFile(file)
    routers.set(router.id, router)
  }
  const routerDef = manifest.router
  const routerID =
    routerDef?.id ??
    (routerDef?.path ? basename(routerDef.path, extname(routerDef.path)) : undefined)
  if (routerDef) {
    if (!routerID) throw new OrchestrationError(index, 'router.id or router.path is required')
    const existing = routers.get(routerID) ?? {
      id: routerID,
      instructions: '',
      routes: [],
      source: routerDef.path ? resolve(dir, routerDef.path) : index,
    }
    routers.set(routerID, {
      ...existing,
      ...(routerDef.strategy ? { strategy: routerDef.strategy } : {}),
      ...(routerDef.routes ? { routes: routerDef.routes } : {}),
      ...(routerDef.path ? { source: resolve(dir, routerDef.path) } : {}),
    })
  }

  const pipelines = new Map<string, PipelineDefinition>()
  for (const file of yamlFiles(join(dir, 'pipelines'))) {
    for (const [id, pipeline] of loadPipelineFile(file)) pipelines.set(id, pipeline)
  }
  if (manifest.pipelines) {
    for (const [id, raw] of Object.entries(manifest.pipelines)) {
      pipelines.set(id, normalizePipeline(raw as unknown as Record<string, unknown>, id, index))
    }
  }

  const tasks = new Map<string, TaskDefinition>()
  const taskDir = manifest.defaults?.task_dir
    ? resolve(dir, manifest.defaults.task_dir)
    : join(dir, 'tasks')
  for (const file of markdownFiles(taskDir)) {
    const task = loadTaskFile(file, taskDir)
    tasks.set(task.name, task)
  }
  if (taskDir !== join(dir, 'tasks')) {
    for (const file of markdownFiles(join(dir, 'tasks'))) {
      const task = loadTaskFile(file, join(dir, 'tasks'))
      tasks.set(task.name, task)
    }
  }

  const imports = new Map<string, LoadedPackage[]>()
  for (const [namespace, entries] of Object.entries(manifest.imports ?? {})) {
    const loaded: LoadedPackage[] = []
    for (const item of entries) {
      const spec: ImportSpec = typeof item === 'string' ? { path: item } : item
      const target = resolveImportPath(namespace, spec.path, dir, stdDir)
      const candidate = existsSync(target) ? target : indexPath(target)
      const child =
        existsSync(candidate) && statSync(candidate).isDirectory()
          ? loadPackageDirectory(candidate, options, stdDir, stack, depth + 1)
          : syntheticPackage(candidate, spec)
      if (spec.select?.length) {
        const allowed = new Set(spec.select)
        child.pipelines = new Map([...child.pipelines].filter(([id]) => allowed.has(id)))
      }
      loaded.push(child)
    }
    imports.set(namespace, loaded)
  }

  const entry: PackageEntry =
    manifest.entry && (manifest.entry.pipeline || manifest.entry.router)
      ? manifest.entry
      : routers.size === 1
        ? { router: routers.keys().next().value as string }
        : pipelines.size === 1
          ? { pipeline: pipelines.keys().next().value as string }
          : {}

  const pkg: LoadedPackage = {
    manifest,
    dir,
    pipelines,
    routers,
    tasks,
    imports,
    entry,
    sources: [
      index,
      ...[...pipelines.values()].flatMap((pipeline) => (pipeline.source ? [pipeline.source] : [])),
      ...[...routers.values()].flatMap((router) => (router.source ? [router.source] : [])),
      ...[...tasks.values()].flatMap((task) => (task.source ? [task.source] : [])),
    ],
  }
  stack.delete(key)
  return pkg
}

function applyOverrides(root: LoadedPackage, overrides: WorkspaceOverrides, source: string): void {
  for (const [ref, override] of Object.entries(overrides)) {
    const parsed = parseRef(ref)
    const target = parsed.namespace
      ? importedPackage(root, parsed.namespace, parsed.alias)
      : undefined
    if (!target) {
      const loaded = [...root.imports.entries()].flatMap(([namespace, packages]) =>
        packages.map((pkg) => `${namespace}:${pkg.manifest.id}`)
      )
      throw new OrchestrationError(
        source,
        `overrides.${ref}: unknown package import${
          loaded.length ? `; loaded imports are ${loaded.join(', ')}` : ''
        }`
      )
    }
    if (override.defaults) {
      target.manifest.defaults = {
        ...(target.manifest.defaults ?? {}),
        ...override.defaults,
      }
    }
    for (const [id, patch] of Object.entries(override.pipelines ?? {})) {
      const pipeline = target.pipelines.get(id)
      if (!pipeline) {
        throw new OrchestrationError(
          source,
          `overrides.${ref}.pipelines.${id}: pipeline not found in ${target.manifest.id}`
        )
      }
      target.pipelines.set(id, { ...pipeline, ...patch })
    }
    for (const [name, patch] of Object.entries(override.tasks ?? {})) {
      const task = target.tasks.get(name)
      if (!task) {
        throw new OrchestrationError(
          source,
          `overrides.${ref}.tasks.${name}: task not found in ${target.manifest.id}`
        )
      }
      target.tasks.set(name, { ...task, ...patch })
    }
  }
}

export function loadCatalog(configPath: string, options: LoadOptions = {}): LoadedCatalog {
  const index = indexPath(resolve(configPath))
  const stdDir = options.stdDir ? resolve(options.stdDir) : findStdDir(dirname(index))
  const raw = parseYamlRecord(readFileSync(index, 'utf8'), index)
  const root = loadPackageDirectory(index, options, stdDir, new Set(), 0)
  const packages: LoadedPackage[] = [root]
  const seen = new Set<string>([resolve(root.dir)])
  const visit = (pkg: LoadedPackage): void => {
    for (const entries of pkg.imports.values()) {
      for (const child of entries) {
        const key = resolve(child.dir)
        if (seen.has(key)) continue
        seen.add(key)
        packages.push(child)
        visit(child)
      }
    }
  }
  visit(root)
  applyOverrides(root, normalizeOverrides(raw.overrides, index), index)
  return { root, packages, configPath: index, stdDir }
}

function parseRef(ref: string): { namespace?: string; alias: string; pipeline?: string } {
  const colon = ref.indexOf(':')
  if (colon === -1) {
    const slash = ref.indexOf('/')
    if (slash === -1) return { alias: ref }
    return { alias: ref.slice(0, slash), pipeline: ref.slice(slash + 1) }
  }
  const namespace = ref.slice(0, colon)
  const rest = ref.slice(colon + 1)
  const slash = rest.indexOf('/')
  if (slash === -1) return { namespace, alias: rest }
  return { namespace, alias: rest.slice(0, slash), pipeline: rest.slice(slash + 1) }
}

function importedPackage(
  pkg: LoadedPackage,
  namespace: string,
  alias: string
): LoadedPackage | undefined {
  const entries = pkg.imports.get(namespace)
  return entries?.find((entry) => entry.manifest.id === alias || basename(entry.dir) === alias)
}

function policyFromStep(
  step: StepDefinition,
  task?: TaskDefinition,
  inherited?: StepPolicy,
  permissions?: PermissionRule[]
): StepPolicy | undefined {
  const base = inherited ?? {}
  const direct = step.policy ?? task?.policy
  const rules = [
    ...(base.rules ?? []),
    ...(direct?.rules ?? []),
    ...(permissions ?? []),
    ...(task?.permissions ?? []),
    ...(step.permissions ?? []),
  ]
  const merged: StepPolicy = {
    ...base,
    ...direct,
    ...(rules.length ? { rules } : {}),
  }
  return Object.keys(merged).length ? merged : undefined
}

type PromptSource = NonNullable<CompiledNode['promptSource']>

function taskPrompt(
  pkg: LoadedPackage,
  step: StepDefinition
): { task?: TaskDefinition; prompt: string; source: PromptSource } {
  const requested = step.task ?? step.name
  const task =
    pkg.tasks.get(requested) ??
    pkg.tasks.get(requested.replace(/^[^:]+:/, '')) ??
    pkg.tasks.get(step.name) ??
    pkg.tasks.get(step.name.replace(/^[^:]+:/, ''))
  const prompt =
    step.prompt ??
    task?.prompt ??
    step.description ??
    `Execute the pipeline step "${step.name}". Use the context provided by the orchestrator and return a concise result.`
  const source: PromptSource = step.prompt
    ? 'step'
    : task?.prompt
      ? 'task'
      : step.description
        ? 'description'
        : 'fallback'
  return { ...(task ? { task } : {}), prompt, source }
}

const STEP_FIELDS = [
  'model',
  'provider',
  'policy',
  'limits',
  'enforcement',
  'background',
  'retries',
  'permissions',
  'requires',
  'strategy',
  'routes',
  'path',
  'task',
  'ref',
  'inputs',
  'artifacts',
  'request',
] as const

const PIPELINE_FIELDS = [
  'default_model',
  'default_provider',
  'policy',
  'limits',
  'enforcement',
  'requires',
  'notification',
] as const

const ROUTER_FIELDS = ['strategy', 'policy', 'limits', 'enforcement', 'requires'] as const

function declaredFields(raw: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => raw[key] !== undefined)
}

function mergeDeclared(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function routerForStep(pkg: LoadedPackage, step: StepDefinition, path: string): RouterDefinition {
  if (step.path) {
    const target = resolve(pkg.dir, step.path)
    const byID = basename(target, extname(target))
    const found =
      pkg.routers.get(byID) ?? [...pkg.routers.values()].find((router) => router.source === target)
    if (!found) throw new OrchestrationError(path, `router file not found: ${step.path}`)
    return {
      ...found,
      ...(step.strategy ? { strategy: step.strategy } : {}),
      ...(step.routes ? { routes: step.routes } : {}),
      ...(step.policy ? { policy: step.policy } : {}),
      ...(step.limits ? { limits: step.limits } : {}),
      ...(step.enforcement ? { enforcement: step.enforcement } : {}),
      ...(step.requires ? { requires: step.requires } : {}),
    }
  }
  if (!step.routes?.length) throw new OrchestrationError(path, 'router step needs path or routes')
  return {
    id: step.name,
    instructions:
      step.prompt ??
      step.description ??
      `Choose one of the routes for ${step.name} and return the route key.`,
    routes: step.routes,
    ...(step.strategy ? { strategy: step.strategy } : {}),
    ...(step.policy ? { policy: step.policy } : {}),
    ...(step.limits ? { limits: step.limits } : {}),
    ...(step.enforcement ? { enforcement: step.enforcement } : {}),
    ...(step.requires ? { requires: step.requires } : {}),
  }
}

function compileStep(
  pkg: LoadedPackage,
  step: StepDefinition,
  path: string,
  stack: Set<string>,
  inheritedModel?: string,
  inheritedProvider?: string,
  inheritedPolicy?: StepPolicy,
  inheritedLimits?: Limits,
  inheritedSource?: string,
  fallbackModel?: string,
  fallbackProvider?: string
): CompiledNode {
  const resolvedTask = step.type === 'task' ? taskPrompt(pkg, step) : undefined
  const model =
    step.model ??
    inheritedModel ??
    resolvedTask?.task?.model ??
    pkg.manifest.defaults?.model ??
    fallbackModel
  const provider =
    step.provider ??
    inheritedProvider ??
    resolvedTask?.task?.provider ??
    pkg.manifest.defaults?.provider ??
    fallbackProvider
  const policy = policyFromStep(step, undefined, inheritedPolicy)
  const limits = step.limits ?? inheritedLimits
  const enforcement = step.enforcement ?? pkg.manifest.defaults?.enforcement
  const source = step.source ?? inheritedSource
  const base = {
    path,
    name: step.name,
    title: step.title ?? step.name,
    packageId: pkg.manifest.id,
    declared: declaredFields(step as unknown as Record<string, unknown>, STEP_FIELDS),
    ...(step.description ? { description: step.description } : {}),
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
    ...(policy ? { policy } : {}),
    ...(limits ? { limits } : {}),
    ...(enforcement ? { enforcement } : {}),
    ...(step.requires ? { requires: step.requires } : {}),
    ...(step.background !== undefined ? { background: step.background } : {}),
    ...(step.retries ? { retries: step.retries } : {}),
    ...(step.inputs ? { inputs: { ...step.inputs } } : {}),
    ...(step.artifacts ? { artifacts: { ...step.artifacts } } : {}),
    ...(step.request !== undefined ? { request: step.request } : {}),
    ...(source ? { source } : {}),
  }

  if (step.type === 'task') {
    if (!resolvedTask) throw new OrchestrationError(path, `task step ${step.name} did not resolve`)
    return {
      ...base,
      kind: 'task',
      prompt: resolvedTask.prompt,
      promptSource: resolvedTask.source,
      ...(resolvedTask.task ? { task: resolvedTask.task.name } : {}),
      ...(resolvedTask.task?.source ? { source: resolvedTask.task.source } : {}),
      ...(policyFromStep(step, resolvedTask.task, inheritedPolicy)
        ? { policy: policyFromStep(step, resolvedTask.task, inheritedPolicy) }
        : {}),
      ...((step.limits ?? resolvedTask.task?.limits ?? inheritedLimits)
        ? { limits: step.limits ?? resolvedTask.task?.limits ?? inheritedLimits }
        : {}),
      ...((step.retries ?? resolvedTask.task?.retries)
        ? { retries: step.retries ?? resolvedTask.task?.retries }
        : {}),
    }
  }

  if (step.type === 'pipeline') {
    if (step.ref) {
      const target = compileRef(pkg, step.ref, path, stack, model, provider)
      return {
        ...target,
        path,
        declared: mergeDeclared(
          target.declared,
          declaredFields(step as unknown as Record<string, unknown>, STEP_FIELDS)
        ),
        ...(step.background !== undefined ? { background: step.background } : {}),
        ...(step.model ? { model: step.model } : {}),
        ...(step.provider ? { provider: step.provider } : {}),
        ...(step.policy ? { policy: policyFromStep(step, undefined, target.policy) } : {}),
        ...(step.limits ? { limits: step.limits } : {}),
        ...(step.enforcement ? { enforcement: step.enforcement } : {}),
        ...(step.retries ? { retries: step.retries } : {}),
        ...(step.inputs ? { inputs: { ...step.inputs } } : {}),
        ...(step.artifacts ? { artifacts: { ...step.artifacts } } : {}),
        ...(step.request !== undefined ? { request: step.request } : {}),
      }
    }
    if (!step.steps?.length) throw new OrchestrationError(path, 'pipeline step needs ref or steps')
    return {
      ...base,
      kind: 'group',
      children: step.steps.map((child, index) =>
        compileStep(
          pkg,
          child,
          `${path}/${index + 1}-${child.name}`,
          stack,
          step.model ?? inheritedModel,
          step.provider ?? inheritedProvider,
          policy,
          limits,
          base.source,
          fallbackModel,
          fallbackProvider
        )
      ),
    }
  }

  if (step.type === 'group') {
    if (!step.steps?.length) throw new OrchestrationError(path, 'group step needs steps')
    return {
      ...base,
      kind: 'group',
      children: step.steps.map((child, index) =>
        compileStep(
          pkg,
          child,
          `${path}/${index + 1}-${child.name}`,
          stack,
          step.model ?? inheritedModel,
          step.provider ?? inheritedProvider,
          policy,
          limits,
          base.source,
          fallbackModel,
          fallbackProvider
        )
      ),
    }
  }

  const router = routerForStep(pkg, step, path)
  const routerKey = `${pkg.dir}#router:${router.id}`
  if (stack.has(routerKey)) throw new OrchestrationError(path, `router cycle at ${router.id}`)
  stack.add(routerKey)
  const routes: CompiledRoute[] = router.routes.map((route) => ({
    ...route,
    target: compileRef(pkg, route.run, `${path}/route-${route.when}`, stack, model, provider),
  }))
  stack.delete(routerKey)
  return {
    ...base,
    kind: 'router',
    prompt: renderRouterPrompt(router.instructions, router.routes),
    promptSource: 'router',
    ...(router.source ? { source: router.source } : {}),
    routes,
    ...(router.strategy ? { strategy: router.strategy } : {}),
    ...(router.policy ? { policy: policyFromStep(step, undefined, router.policy) } : {}),
    ...(router.limits ? { limits: router.limits } : {}),
    ...(router.enforcement ? { enforcement: router.enforcement } : {}),
  }
}

function compilePipeline(
  pkg: LoadedPackage,
  id: string,
  path: string,
  stack: Set<string>,
  fallbackModel?: string,
  fallbackProvider?: string
): CompiledNode {
  const pipeline = pkg.pipelines.get(id)
  if (!pipeline)
    throw new OrchestrationError(path, `pipeline not found: ${id} in ${pkg.manifest.id}`)
  const key = `${pkg.dir}#pipeline:${id}`
  if (stack.has(key)) throw new OrchestrationError(path, `pipeline ref cycle at ${id}`)
  stack.add(key)
  const node: CompiledNode = {
    path,
    kind: 'pipeline',
    name: pipeline.id,
    title: pipeline.name,
    packageId: pkg.manifest.id,
    declared: declaredFields(pipeline as unknown as Record<string, unknown>, PIPELINE_FIELDS),
    ...(pipeline.description ? { description: pipeline.description } : {}),
    ...((pipeline.default_model ?? pkg.manifest.defaults?.model ?? fallbackModel)
      ? { model: pipeline.default_model ?? pkg.manifest.defaults?.model ?? fallbackModel }
      : {}),
    ...((pipeline.default_provider ?? pkg.manifest.defaults?.provider ?? fallbackProvider)
      ? {
          provider:
            pipeline.default_provider ?? pkg.manifest.defaults?.provider ?? fallbackProvider,
        }
      : {}),
    ...(pipeline.policy ? { policy: pipeline.policy } : {}),
    ...(pipeline.limits ? { limits: pipeline.limits } : {}),
    ...((pipeline.enforcement ?? pkg.manifest.defaults?.enforcement)
      ? { enforcement: pipeline.enforcement ?? pkg.manifest.defaults?.enforcement }
      : {}),
    ...(pipeline.requires ? { requires: pipeline.requires } : {}),
    children: pipeline.steps.map((step, index) =>
      compileStep(
        pkg,
        step,
        `${path}/${index + 1}-${step.name}`,
        stack,
        pipeline.default_model,
        pipeline.default_provider,
        pipeline.policy,
        pipeline.limits,
        pipeline.source,
        fallbackModel,
        fallbackProvider
      )
    ),
    ...(pipeline.source ? { source: pipeline.source } : {}),
  }
  stack.delete(key)
  return node
}

function compileEntry(
  pkg: LoadedPackage,
  path: string,
  stack: Set<string>,
  fallbackModel?: string,
  fallbackProvider?: string
): CompiledNode {
  const entry = pkg.entry
  if (entry.router) {
    const router = pkg.routers.get(entry.router)
    if (!router) throw new OrchestrationError(path, `entry router not found: ${entry.router}`)
    const routerKey = `${pkg.dir}#router:${router.id}`
    if (stack.has(routerKey)) throw new OrchestrationError(path, `router cycle at ${router.id}`)
    stack.add(routerKey)
    const model = pkg.manifest.defaults?.model ?? fallbackModel
    const provider = pkg.manifest.defaults?.provider ?? fallbackProvider
    const routes = router.routes.map((route) => ({
      ...route,
      target: compileRef(pkg, route.run, `${path}/route-${route.when}`, stack, model, provider),
    }))
    stack.delete(routerKey)
    const node: CompiledNode = {
      path,
      kind: 'router',
      name: router.id,
      title: router.id,
      packageId: pkg.manifest.id,
      declared: declaredFields(router as unknown as Record<string, unknown>, ROUTER_FIELDS),
      prompt: renderRouterPrompt(router.instructions, router.routes),
      promptSource: 'router',
      routes,
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(router.description ? { description: router.description } : {}),
      ...(router.strategy ? { strategy: router.strategy } : {}),
      ...(router.policy ? { policy: router.policy } : {}),
      ...(router.limits ? { limits: router.limits } : {}),
      ...((router.enforcement ?? pkg.manifest.defaults?.enforcement)
        ? { enforcement: router.enforcement ?? pkg.manifest.defaults?.enforcement }
        : {}),
      ...(router.requires ? { requires: router.requires } : {}),
      ...(router.source ? { source: router.source } : {}),
    }
    return node
  }
  if (entry.pipeline) {
    return compilePipeline(pkg, entry.pipeline, path, stack, fallbackModel, fallbackProvider)
  }
  throw new OrchestrationError(path, `package ${pkg.manifest.id} has no entry`)
}

export function compileRef(
  pkg: LoadedPackage,
  ref: string,
  path: string,
  stack: Set<string> = new Set(),
  fallbackModel?: string,
  fallbackProvider?: string
): CompiledNode {
  const parsed = parseRef(ref)
  if (parsed.namespace) {
    const target = importedPackage(pkg, parsed.namespace, parsed.alias)
    if (!target)
      throw new OrchestrationError(path, `unknown import ${parsed.namespace}:${parsed.alias}`)
    if (parsed.pipeline) {
      return compilePipeline(target, parsed.pipeline, path, stack, fallbackModel, fallbackProvider)
    }
    return compileEntry(target, path, stack, fallbackModel, fallbackProvider)
  }
  if (parsed.pipeline) {
    // A slash without a namespace is a local path-like reference.
    return compilePipeline(pkg, parsed.alias, path, stack, fallbackModel, fallbackProvider)
  }
  // A bare package id selects that package's entry. Keep a real pipeline with
  // the same id working by only using the entry when no pipeline matches.
  if (parsed.alias === pkg.manifest.id && !pkg.pipelines.has(parsed.alias)) {
    return compileEntry(pkg, path, stack, fallbackModel, fallbackProvider)
  }
  return compilePipeline(pkg, parsed.alias, path, stack, fallbackModel, fallbackProvider)
}

function resolveWiring(root: CompiledNode): void {
  const resolveContainer = (container: CompiledNode): void => {
    const children = container.children ?? []
    const byName = new Map<string, CompiledNode>()
    for (const child of children) {
      if (byName.has(child.name)) {
        throw new OrchestrationError(
          container.path,
          `duplicate step name "${child.name}" in ${container.name}`
        )
      }
      byName.set(child.name, child)
    }
    for (const [index, child] of children.entries()) {
      if (child.inputs) {
        const resolved: Record<string, string> = {}
        for (const [label, ref] of Object.entries(child.inputs)) {
          const target = byName.get(ref)
          if (!target) {
            const names = [...byName.keys()].filter((name) => name !== child.name)
            throw new OrchestrationError(
              child.path,
              `inputs.${label}: step "${ref}" is not in this pipeline${
                names.length ? ` (available: ${names.join(', ')})` : ''
              }`
            )
          }
          if (target === child) {
            throw new OrchestrationError(
              child.path,
              `inputs.${label}: a step cannot reference itself`
            )
          }
          if (children.indexOf(target) > index) {
            throw new OrchestrationError(
              child.path,
              `inputs.${label}: "${ref}" comes later in the pipeline; inputs must reference an earlier step`
            )
          }
          if (target.background) {
            throw new OrchestrationError(
              child.path,
              `inputs.${label}: "${ref}" is background, so its result is not guaranteed when this step starts`
            )
          }
          resolved[label] = target.path
        }
        child.inputs = resolved
      }
      for (const [label, artifact] of Object.entries(child.artifacts ?? {})) {
        if (isAbsolute(artifact) || artifact.split(/[\\/]/).includes('..')) {
          throw new OrchestrationError(
            child.path,
            `artifacts.${label}: "${artifact}" must be a workspace-relative path`
          )
        }
      }
      resolveContainer(child)
    }
  }
  resolveContainer(root)
}

export function compileRun(catalog: LoadedCatalog, targetRef?: string): CompiledRun {
  const fallbackModel = catalog.root.manifest.defaults?.model
  const fallbackProvider = catalog.root.manifest.defaults?.provider
  const root = targetRef
    ? compileRef(catalog.root, targetRef, targetRef, new Set(), fallbackModel, fallbackProvider)
    : compileEntry(
        catalog.root,
        catalog.root.manifest.id,
        new Set(),
        fallbackModel,
        fallbackProvider
      )
  resolveWiring(root)
  const sources = [...new Set(catalog.packages.flatMap((pkg) => pkg.sources))].sort()
  const snapshot = JSON.stringify({
    root,
    sources,
    packages: catalog.packages.map((pkg) => ({
      id: pkg.manifest.id,
      version: pkg.manifest.version,
      dir: pkg.dir,
    })),
  })
  const hash = `sha256:${createHash('sha256').update(snapshot).digest('hex')}`
  return { root, hash, snapshot, sources, catalog }
}

export function catalogSummary(catalog: LoadedCatalog) {
  return catalog.packages.map((pkg) => ({
    id: pkg.manifest.id,
    name: pkg.manifest.name,
    version: pkg.manifest.version,
    path: pkg.dir,
    entry: pkg.entry,
    pipelines: [...pkg.pipelines.keys()],
    routers: [...pkg.routers.keys()],
    tasks: [...pkg.tasks.keys()],
  }))
}
