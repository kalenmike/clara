import { useEffect, useMemo, useState } from 'react'
import { Badge, Empty } from './Badge'
import { Card } from '@clara/ui/components/card'
import { Textarea } from '@clara/ui/components/textarea'
import { Notice } from '@clara/ui/patterns/notice'
import { Button } from '@clara/ui/components/button'
import { callTool } from '../api'
import type { CallRecord } from '../types'
import type { LabStream } from '../useLab'
import { clock, duration, json, short } from '../lib/format'
import {
  buildArgs,
  describeToolInput,
  initialValues,
  setFieldValue,
  valuesFromArgs,
  type FieldValues,
} from '../lib/schema'
import { Icon } from './Icon'
import { CopyButton, JsonView } from './Json'
import { ToolForm } from './ToolForm'

type Mode = 'form' | 'json'

function parseArgsObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Arguments must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function Console({ stream }: { stream: LabStream }) {
  const tools = stream.snapshot?.tools ?? []
  const [tool, setTool] = useState('clara_list')
  const [mode, setMode] = useState<Mode>('form')
  const [valuesByTool, setValuesByTool] = useState<Record<string, FieldValues>>({})
  const [rawByTool, setRawByTool] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tools.length) return
    if (!tools.some((entry) => entry.name === tool)) setTool(tools[0].name)
  }, [tools, tool])

  const selected = tools.find((entry) => entry.name === tool)
  const fields = describeToolInput(selected?.inputSchema)
  const formMode = mode === 'form' && fields !== null
  const values: FieldValues = fields ? (valuesByTool[tool] ?? initialValues(fields)) : {}
  const raw = rawByTool[tool] ?? '{}'
  const recent = useMemo(
    () =>
      stream.calls
        .filter((call) => call.source === 'ui')
        .slice(-20)
        .reverse(),
    [stream.calls]
  )

  const selectTool = (name: string): void => {
    if (name === tool) return
    setTool(name)
    setResult(null)
    setError(null)
    setNotice(null)
    setErrors({})
    if (mode === 'json') {
      const nextFields = describeToolInput(tools.find((entry) => entry.name === name)?.inputSchema)
      if (nextFields) {
        const nextValues = valuesByTool[name] ?? initialValues(nextFields)
        const payload = json(buildArgs(nextFields, nextValues).args)
        setRawByTool((current) => ({ ...current, [name]: current[name] ?? payload }))
      }
    }
  }

  const setValue = (path: string[], value: string): void => {
    const key = path.join('.')
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
    setNotice(null)
    setValuesByTool((current) => ({
      ...current,
      [tool]: setFieldValue(current[tool] ?? (fields ? initialValues(fields) : {}), path, value),
    }))
  }

  const updateRaw = (value: string): void => {
    setRawByTool((current) => ({ ...current, [tool]: value }))
    setError(null)
    setNotice(null)
  }

  const changeMode = (next: Mode): void => {
    if (next === mode) return
    setErrors({})
    setNotice(null)
    setError(null)
    if (next === 'json') {
      if (fields) {
        const payload = buildArgs(fields, values).args
        setRawByTool((current) => ({ ...current, [tool]: json(payload) }))
      }
      setMode('json')
      return
    }
    if (!fields) {
      setMode('form')
      return
    }
    let parsed: Record<string, unknown>
    try {
      parsed = parseArgsObject(raw)
    } catch (cause) {
      setError(messageOf(cause))
      return
    }
    const known = new Set(fields.map((field) => field.name))
    const dropped = Object.keys(parsed).filter((key) => !known.has(key))
    setValuesByTool((current) => ({ ...current, [tool]: valuesFromArgs(fields, parsed) }))
    setMode('form')
    if (dropped.length) {
      setNotice(
        `Unknown argument${dropped.length === 1 ? '' : 's'} dropped: ${dropped.join(', ')}.`
      )
    }
  }

  const send = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      let args: Record<string, unknown>
      if (formMode && fields) {
        const built = buildArgs(fields, values)
        if (Object.keys(built.errors).length) {
          setErrors(built.errors)
          return
        }
        setErrors({})
        args = built.args
      } else {
        args = parseArgsObject(raw)
      }
      setResult(null)
      const response = await callTool(tool, args)
      setResult(response)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const load = (call: CallRecord): void => {
    const callFields = describeToolInput(
      tools.find((entry) => entry.name === call.tool)?.inputSchema
    )
    setTool(call.tool)
    setResult(call.error ? undefined : call.result)
    setError(call.error ?? null)
    setNotice(null)
    setErrors({})
    setRawByTool((current) => ({ ...current, [call.tool]: json(call.args ?? {}) }))
    if (callFields) {
      setValuesByTool((current) => ({
        ...current,
        [call.tool]: valuesFromArgs(callFields, call.args),
      }))
    }
  }

  return (
    <div className="view console-view">
      <header className="view-head">
        <div>
          <div className="view-kicker">Probe</div>
          <h1>Tool console</h1>
          <p className="muted">
            Call the engine MCP surface directly. Every request is recorded in Traffic.
          </p>
        </div>
        <div className="view-head-actions">
          <Badge tone={stream.snapshot?.connected ? 'ok' : 'bad'}>{tools.length} tools</Badge>
        </div>
      </header>

      <div className="console-grid">
        <Card asChild>
          <aside className="console-tools">
            <div className="mb-2 flex items-start justify-between gap-2.5">
              <h3>Tools</h3>
              <span className="muted">{tools.length}</span>
            </div>
            <div className="tool-picker">
              {tools.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  className={`tool-option ${entry.name === tool ? 'active' : ''}`}
                  onClick={() => selectTool(entry.name)}
                >
                  <code>{entry.name}</code>
                  {entry.description ? <span>{short(entry.description, 110)}</span> : null}
                </button>
              ))}
            </div>

            <div className="mb-2 flex items-start justify-between gap-2.5">
              <h3>Recent calls</h3>
              <span className="muted">{recent.length}</span>
            </div>
            <div className="recent-calls">
              {recent.map((call) => (
                <button
                  key={call.id}
                  type="button"
                  className={`recent-call ${call.isError ? 'bad' : ''}`}
                  onClick={() => load(call)}
                >
                  <span className="event-time">{clock(call.at)}</span>
                  <code>{call.tool}</code>
                  <span className="muted">{duration(call.durationMs)}</span>
                </button>
              ))}
              {!recent.length ? <Empty>No calls yet.</Empty> : null}
            </div>
          </aside>
        </Card>

        <Card asChild>
          <section className="console-main">
            <div className="console-tool-head">
              <div>
                <h2>
                  <code>{tool}</code>
                </h2>
                <p className="muted">{selected?.description ?? 'Select a tool to inspect it.'}</p>
              </div>
              <Button
                type="button"
                onClick={() => void send()}
                disabled={busy || !tool}
                variant="default"
              >
                <Icon name="play" size={14} />
                {busy ? 'Calling…' : 'Call tool'}
              </Button>
            </div>

            <div className="console-args">
              <div className="row-between">
                <span className="field-label">Arguments</span>
                {fields ? (
                  <div className="segmented">
                    <button
                      type="button"
                      className={formMode ? 'active' : ''}
                      onClick={() => changeMode('form')}
                    >
                      Form
                    </button>
                    <button
                      type="button"
                      className={!formMode ? 'active' : ''}
                      onClick={() => changeMode('json')}
                    >
                      JSON
                    </button>
                  </div>
                ) : (
                  <span className="field-label">raw JSON</span>
                )}
              </div>

              {formMode && fields ? (
                <ToolForm
                  fields={fields}
                  values={values}
                  errors={errors}
                  disabled={busy}
                  onChange={setValue}
                />
              ) : (
                <label className="field-block grow-block">
                  <span>Arguments (JSON object)</span>
                  <Textarea
                    rows={8}
                    value={raw}
                    onChange={(event) => updateRaw(event.target.value)}
                    spellCheck={false}
                    disabled={busy}
                  />
                </label>
              )}

              {notice ? <Notice tone="warning">{notice}</Notice> : null}
              {error ? <Notice tone="danger">{error}</Notice> : null}
            </div>

            {result !== null && result !== undefined ? (
              <div className="console-result">
                <div className="row-between">
                  <h3>Result</h3>
                  <CopyButton value={result} />
                </div>
                <JsonView value={result} maxHeight={420} />
              </div>
            ) : (
              <Empty>Call a tool to see its result here.</Empty>
            )}

            {selected?.inputSchema ? (
              <details className="context">
                <summary>Input schema</summary>
                <JsonView value={selected.inputSchema} maxHeight={320} />
              </details>
            ) : null}
          </section>
        </Card>
      </div>
    </div>
  )
}
