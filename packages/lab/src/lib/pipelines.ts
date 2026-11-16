import type { PackageEntryInfo, TargetInfo } from '../types'

export interface PipelineLeaf {
  ref: string
  id: string
  name: string
  description?: string
  kind: 'entry' | 'pipeline' | 'wrapper'
}

export interface PipelinePackage {
  id: string
  name: string
  alias?: string
  entry?: PipelineLeaf
  pipelines: PipelineLeaf[]
  wrappers: PipelineLeaf[]
  disabled: boolean
}

export interface PipelineNamespace {
  id: string
  label: string
  packages: PipelinePackage[]
}

export function buildPipelineTree(
  packages: PackageEntryInfo[],
  targets: TargetInfo[]
): PipelineNamespace[] {
  const targetByRef = new Map(targets.map((target) => [target.ref, target]))
  const namespaces = new Map<string, PipelinePackage[]>()

  for (const pkg of packages) {
    const namespaceID = pkg.namespace ?? 'root'
    const alias = pkg.alias ?? pkg.id
    const entryRef = pkg.namespace ? `${pkg.namespace}:${alias}` : ''
    const entryTarget = targetByRef.get(entryRef)
    const entry: PipelineLeaf | undefined =
      entryTarget && (pkg.entry.pipeline || pkg.entry.router)
        ? {
            ref: entryRef,
            id: 'entry',
            name: pkg.entry.router
              ? `Router ${pkg.entry.router}`
              : `Pipeline ${pkg.entry.pipeline}`,
            ...(entryTarget.description ? { description: entryTarget.description } : {}),
            kind: 'entry',
          }
        : undefined
    const pipelines: PipelineLeaf[] = []
    for (const pipeline of pkg.pipelines) {
      const ref = pkg.namespace ? `${pkg.namespace}:${alias}/${pipeline.id}` : pipeline.id
      if (!targetByRef.has(ref)) continue
      pipelines.push({
        ref,
        id: pipeline.id,
        name: pipeline.name,
        ...(pipeline.description ? { description: pipeline.description } : {}),
        kind: 'pipeline',
      })
    }

    const wrappers: PipelineLeaf[] = []
    for (const wrapper of pkg.wrappers) {
      const ref = pkg.namespace ? `${pkg.namespace}:${alias}/${wrapper.id}` : wrapper.id
      const target = targetByRef.get(ref)
      if (!target || target.kind !== 'wrapper') continue
      wrappers.push({
        ref,
        id: wrapper.id,
        name: wrapper.name,
        ...(wrapper.description ? { description: wrapper.description } : {}),
        kind: 'wrapper',
      })
    }

    const list = namespaces.get(namespaceID) ?? []
    list.push({
      id: pkg.id,
      name: pkg.name,
      ...(pkg.alias ? { alias: pkg.alias } : {}),
      ...(entry ? { entry } : {}),
      pipelines,
      wrappers,
      disabled: !entry && pipelines.length === 0 && wrappers.length === 0,
    })
    namespaces.set(namespaceID, list)
  }

  return [...namespaces.entries()]
    .map(([id, list]) => ({
      id,
      label: id === 'root' ? 'Workspace' : id,
      packages: list.sort((left, right) =>
        (left.alias ?? left.id).localeCompare(right.alias ?? right.id)
      ),
    }))
    .sort((left, right) => {
      if (left.id === 'root') return -1
      if (right.id === 'root') return 1
      return left.id.localeCompare(right.id)
    })
}
