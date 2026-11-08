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
  PackageEntry,
  PackageManifest,
  PipelineDefinition,
  RouteDefinition,
  RouterDefinition,
  StepDefinition,
  TaskDefinition,
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

function normalizeStep(raw: unknown, source: string, index: number): StepDefinition {
  if (!isRecord(raw)) throw new OrchestrationError(source, `steps[${index}] must be an object`)
  const name = str(raw.name) ?? str(raw.id)
  if (!name) throw new OrchestrationError(source, `steps[${index}].name is required`)
  const type = (str(raw.type) ?? (raw.steps ? 'group' : 'task')) as StepDefinition['type']
  if (!['task', 'pipeline', 'router', 'group'].includes(type)) {
    throw new OrchestrationError(source, `steps[${index}].type is invalid`)
  }
  return {
    name,
    type,
    ...(str(raw.title) ? { title: String(raw.title) } : {}),
    ...(str(raw.description) ? { description: String(raw.description) } : {}),
    ...(str(raw.prompt) ? { prompt: String(raw.prompt) } : {}),
    ...(str(raw.task) ? { task: String(raw.task) } : {}),
    ...(str(raw.ref) ? { ref: String(raw.ref) } : {}),
    ...(str(raw.path) ? { path: String(raw.path) } : {}),
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

export function loadCatalog(configPath: string, options: LoadOptions = {}): LoadedCatalog {
  const index = indexPath(resolve(configPath))
  const stdDir = options.stdDir ? resolve(options.stdDir) : findStdDir(dirname(index))
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
  inheritedSource?: string
): CompiledNode {
  const model = step.model ?? inheritedModel ?? pkg.manifest.defaults?.model
  const provider = step.provider ?? inheritedProvider ?? pkg.manifest.defaults?.provider
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
    ...(source ? { source } : {}),
  }

  if (step.type === 'task') {
    const resolved = taskPrompt(pkg, step)
    return {
      ...base,
      kind: 'task',
      prompt: resolved.prompt,
      promptSource: resolved.source,
      ...(resolved.task ? { task: resolved.task.name } : {}),
      ...(resolved.task?.source ? { source: resolved.task.source } : {}),
      ...(resolved.task?.model && !model ? { model: resolved.task.model } : {}),
      ...(resolved.task?.provider && !provider ? { provider: resolved.task.provider } : {}),
      ...(policyFromStep(step, resolved.task, inheritedPolicy)
        ? { policy: policyFromStep(step, resolved.task, inheritedPolicy) }
        : {}),
      ...((step.limits ?? resolved.task?.limits ?? inheritedLimits)
        ? { limits: step.limits ?? resolved.task?.limits ?? inheritedLimits }
        : {}),
      ...((step.retries ?? resolved.task?.retries)
        ? { retries: step.retries ?? resolved.task?.retries }
        : {}),
    }
  }

  if (step.type === 'pipeline') {
    if (step.ref) {
      const target = compileRef(pkg, step.ref, path, stack)
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
          model,
          provider,
          policy,
          limits,
          base.source
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
          model,
          provider,
          policy,
          limits,
          base.source
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
    target: compileRef(pkg, route.run, `${path}/route-${route.when}`, stack),
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
  stack: Set<string>
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
    ...((pipeline.default_model ?? pkg.manifest.defaults?.model)
      ? { model: pipeline.default_model ?? pkg.manifest.defaults?.model }
      : {}),
    ...((pipeline.default_provider ?? pkg.manifest.defaults?.provider)
      ? { provider: pipeline.default_provider ?? pkg.manifest.defaults?.provider }
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
        pipeline.default_model ?? pkg.manifest.defaults?.model,
        pipeline.default_provider ?? pkg.manifest.defaults?.provider,
        pipeline.policy,
        pipeline.limits,
        pipeline.source
      )
    ),
    ...(pipeline.source ? { source: pipeline.source } : {}),
  }
  stack.delete(key)
  return node
}

function compileEntry(pkg: LoadedPackage, path: string, stack: Set<string>): CompiledNode {
  const entry = pkg.entry
  if (entry.router) {
    const router = pkg.routers.get(entry.router)
    if (!router) throw new OrchestrationError(path, `entry router not found: ${entry.router}`)
    const routerKey = `${pkg.dir}#router:${router.id}`
    if (stack.has(routerKey)) throw new OrchestrationError(path, `router cycle at ${router.id}`)
    stack.add(routerKey)
    const routes = router.routes.map((route) => ({
      ...route,
      target: compileRef(pkg, route.run, `${path}/route-${route.when}`, stack),
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
      ...(pkg.manifest.defaults?.model ? { model: pkg.manifest.defaults.model } : {}),
      ...(pkg.manifest.defaults?.provider ? { provider: pkg.manifest.defaults.provider } : {}),
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
  if (entry.pipeline) return compilePipeline(pkg, entry.pipeline, path, stack)
  throw new OrchestrationError(path, `package ${pkg.manifest.id} has no entry`)
}

export function compileRef(
  pkg: LoadedPackage,
  ref: string,
  path: string,
  stack: Set<string> = new Set()
): CompiledNode {
  const parsed = parseRef(ref)
  if (parsed.namespace) {
    const target = importedPackage(pkg, parsed.namespace, parsed.alias)
    if (!target)
      throw new OrchestrationError(path, `unknown import ${parsed.namespace}:${parsed.alias}`)
    if (parsed.pipeline) return compilePipeline(target, parsed.pipeline, path, stack)
    return compileEntry(target, path, stack)
  }
  if (parsed.pipeline) {
    // A slash without a namespace is a local path-like reference.
    return compilePipeline(pkg, parsed.alias, path, stack)
  }
  return compilePipeline(pkg, parsed.alias, path, stack)
}

export function compileRun(catalog: LoadedCatalog, targetRef?: string): CompiledRun {
  const root = targetRef
    ? compileRef(catalog.root, targetRef, targetRef, new Set())
    : compileEntry(catalog.root, catalog.root.manifest.id, new Set())
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
