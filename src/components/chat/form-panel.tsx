import { useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import type { FormField, FormInfo } from '@opencode/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useRejectForm,
  useReplyForm,
  useSessionForms,
  type FormAnswerValue,
} from '@/features/chat/use-forms'

export function FormPanel({ sessionID }: { sessionID: string }) {
  const formsQuery = useSessionForms(sessionID)
  const forms = formsQuery.data ?? []
  if (forms.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 border-b bg-sky-500/5 p-2 md:p-3">
      {forms.map((form) => (
        <FormCard key={form.id} sessionID={sessionID} form={form} />
      ))}
    </div>
  )
}

function FormCard({ sessionID, form }: { sessionID: string; form: FormInfo }) {
  const reply = useReplyForm(sessionID)
  const reject = useRejectForm(sessionID)
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>(() =>
    initialAnswers(form.fields)
  )

  const fields = useMemo(
    () => form.fields.filter((field) => !('hidden' in field && field.hidden)),
    [form.fields]
  )

  const submit = () => {
    reply.mutate({ formID: form.id, answer: answers })
  }

  return (
    <div className="mx-auto max-w-3xl rounded-xl border border-sky-500/30 bg-card p-3">
      <div className="flex items-start gap-2">
        <CircleHelp className="mt-0.5 size-4 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">{form.title}</div>
          <div className="mt-3 space-y-3">
            {fields.map((field) => (
              <Field
                key={field.key}
                field={field}
                value={answers[field.key]}
                onChange={(value) => setAnswers((current) => ({ ...current, [field.key]: value }))}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={submit} disabled={reply.isPending}>
              Submit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => reject.mutate({ formID: form.id })}
              disabled={reject.isPending}
            >
              Skip
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: FormAnswerValue | undefined
  onChange: (value: FormAnswerValue) => void
}) {
  if (field.type === 'external') {
    return (
      <div className="text-xs">
        <a href={field.url} target="_blank" rel="noreferrer" className="underline">
          {field.title ?? field.url}
        </a>
        {field.description && (
          <p className="mt-1 text-[11px] text-muted-foreground">{field.description}</p>
        )}
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          className="size-3.5 accent-foreground"
        />
        {field.title ?? field.key}
      </label>
    )
  }

  if (field.type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="space-y-1">
        <div className="text-xs font-medium">{field.title ?? field.key}</div>
        <div className="flex flex-wrap gap-2">
          {field.options.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => {
                  onChange(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value)
                  )
                }}
                className="size-3.5 accent-foreground"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'string' && field.options) {
    return (
      <label className="block space-y-1">
        <span className="text-xs font-medium">{field.title ?? field.key}</span>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.type === 'number' || field.type === 'integer') {
    return (
      <label className="block space-y-1">
        <span className="text-xs font-medium">{field.title ?? field.key}</span>
        <Input
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-8 text-xs"
        />
      </label>
    )
  }

  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{field.title ?? field.key}</span>
      {field.description && (
        <span className="block text-[11px] text-muted-foreground">{field.description}</span>
      )}
      <Input
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.type === 'string' ? field.placeholder : undefined}
        className="h-8 text-xs"
      />
    </label>
  )
}

function initialAnswers(fields: FormField[]): Record<string, FormAnswerValue> {
  const answers: Record<string, FormAnswerValue> = {}
  for (const field of fields) {
    if ('hidden' in field && field.hidden) continue
    if (field.type === 'string' && field.default !== undefined) answers[field.key] = field.default
    if (
      (field.type === 'number' || field.type === 'integer') &&
      typeof field.default === 'number'
    ) {
      answers[field.key] = field.default
    }
    if (field.type === 'boolean') answers[field.key] = field.default ?? false
    if (field.type === 'multiselect' && field.default) answers[field.key] = field.default
  }
  return answers
}
