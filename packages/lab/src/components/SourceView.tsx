import { useEffect, useState } from 'react'
import { Empty } from './Badge'
import { getSource } from '../api'
import { CopyButton } from './Json'

export function SourceView({ path }: { path?: string }) {
  const [source, setSource] = useState<{ path: string; text: string; truncated: boolean } | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) return
    let alive = true
    setSource(null)
    setError(null)
    void getSource(path)
      .then((value) => {
        if (alive) setSource(value)
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      alive = false
    }
  }, [path])

  if (!path) return <Empty>No source file is recorded for this node.</Empty>
  if (error) return <Empty>{error}</Empty>
  if (!source) return <Empty>Loading {path}…</Empty>

  const lines = source.text.split('\n')
  return (
    <div className="source">
      <div className="source-head">
        <code>{path}</code>
        <CopyButton value={source.text} />
      </div>
      {source.truncated ? <div className="muted">Showing the first 512 KB.</div> : null}
      <pre className="source-code">
        {lines.map((line, index) => (
          <span key={index} className="source-line">
            <span className="source-number">{index + 1}</span>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  )
}
