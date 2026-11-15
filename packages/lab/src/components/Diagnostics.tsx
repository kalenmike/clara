import type { Diagnostic } from '../types'
import { Button } from '@clara/ui/components/button'
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
            <Button
              type="button"
              variant="link"
              className="inline h-auto p-0 text-xs"
              onClick={() => onOpenSource(diagnostic.path as string)}
            >
              {diagnostic.path}
            </Button>
          ) : diagnostic.path ? (
            <span className="muted">{diagnostic.path}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
