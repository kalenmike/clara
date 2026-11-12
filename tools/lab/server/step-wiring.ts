import { flattenCompiled, inspectSnapshot } from '@clara/pipeline-preview'
import type { StepArtifact, StepInput, StepSummary } from './types.ts'

export interface StepWiring {
  inputs: StepInput[]
  artifacts: StepArtifact[]
  request: boolean
}

const EMPTY: StepWiring = { inputs: [], artifacts: [], request: true }

function parseResult(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

/**
 * Resolve the wiring a pinned step declared into the shape the Runs view needs.
 * Input results come from the run status because the pinned snapshot only
 * carries the declared paths.
 */
export function resolveStepWiring(
  snapshot: string | undefined,
  stepPath: string,
  steps: StepSummary[]
): StepWiring {
  if (!snapshot) return EMPTY

  let node
  try {
    node = flattenCompiled(inspectSnapshot(snapshot)).get(stepPath)
  } catch {
    return EMPTY
  }
  if (!node) return EMPTY

  const byPath = new Map(steps.map((step) => [step.path, step]))
  const inputs = Object.entries(node.inputs ?? {}).map(([label, path]) => {
    const input = byPath.get(path)
    return {
      label,
      path,
      name: input?.name ?? path,
      ...(input?.status ? { status: input.status } : {}),
      result: parseResult(input?.result),
    }
  })
  const artifacts = Object.entries(node.artifacts ?? {}).map(([label, path]) => ({ label, path }))

  return { inputs, artifacts, request: node.request !== false }
}
