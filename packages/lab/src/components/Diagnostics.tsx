import type { Diagnostic } from '../types'
import { Badge } from './Badge'

export function Diagnostics({
  diagnostics,
  onOpenSource,
}: {
  diagnostics: Diagnostic[]
  onOpenSource?: (path: string) => void
}) {
  if (!diagnostics.length) {
    return (
      <div className="diagnostics diagnostics-ok">
        No diagnostics. The package compiles cleanly.
      </div>
    )
  }
  return (
    <div className="diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.code}-${diagnostic.stepPath ?? diagnostic.path ?? index}`}
          className={`diagnostic diagnostic-${diagnostic.severity}`}
        >
          <Badge
            tone={
              diagnostic.severity === 'error'
                ? 'bad'
                : diagnostic.severity === 'warning'
                  ? 'warn'
                  : 'idle'
            }
          >
            {diagnostic.severity}
          </Badge>
          <span className="diagnostic-code">{diagnostic.code}</span>
          <span className="diagnostic-message">{diagnostic.message}</span>
          {diagnostic.path && onOpenSource ? (
            <button
              type="button"
              className="link"
              onClick={() => onOpenSource(diagnostic.path as string)}
            >
              {diagnostic.path}
            </button>
          ) : diagnostic.path ? (
            <span className="muted">{diagnostic.path}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
