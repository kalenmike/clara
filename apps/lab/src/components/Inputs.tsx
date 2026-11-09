import type { StepArtifact, StepInput } from '../types'
import { JsonView } from './Json'

export function InputList({
  inputs,
  artifacts = [],
  empty = 'No inputs are declared.',
}: {
  inputs: StepInput[]
  artifacts?: StepArtifact[]
  empty?: string
}) {
  return (
    <div className="input-list">
      {inputs.length ? (
        inputs.map((input) => (
          <div className="input-item" key={`${input.label}:${input.path}`}>
            <div className="row-between">
              <strong>{input.label}</strong>
              <span className="muted">
                <code>{input.path}</code>
                {input.name !== input.path ? ` · ${input.name}` : ''}
                {input.status ? ` · ${input.status}` : ''}
              </span>
            </div>
            {input.result !== null && input.result !== undefined ? (
              <JsonView value={input.result} maxHeight={220} />
            ) : (
              <div className="muted">No result recorded yet.</div>
            )}
          </div>
        ))
      ) : (
        <div className="muted">{empty}</div>
      )}

      {artifacts.length ? (
        <>
          <h4>Artifacts</h4>
          <ul className="input-artifacts">
            {artifacts.map((artifact) => (
              <li key={`${artifact.label}:${artifact.path}`}>
                <strong>{artifact.label}</strong> <code>{artifact.path}</code>
                {artifact.exists === false ? <span className="muted"> · missing</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
