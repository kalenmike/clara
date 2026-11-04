import { useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import type { FormField, FormInfo } from '@opencode/client'
import { RequestCard } from '@/components/chat/request-card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useRejectForm,
  useReplyForm,
  useSessionForms,
  type FormAnswerValue,
} from '@/features/chat/use-forms'

const CLEAR_SELECTION = '__clear__'
const OPTION_PREFIX = 'option:'

function optionID(value: string) {
  return `${OPTION_PREFIX}${value}`
}

export function FormPanel({ sessionID }: { sessionID: string }) {
  const formsQuery = useSessionForms(sessionID)
  const forms = formsQuery.data ?? []
  if (forms.length === 0) return null

  return (
    <div className="shrink-0 space-y-2 border-b bg-sky-500/5 p-2 md:p-3">
      {forms.map((form) => (
        <FormCard key={`${sessionID}:${form.id}`} sessionID={sessionID} form={form} />
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
    <RequestCard title={form.title} icon={CircleHelp} tone="sky">
      <div className="space-y-3">
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
        <Button
          size="sm"
          className="h-7 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
          onClick={submit}
          disabled={reply.isPending}
        >
          Submit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
          onClick={() => reject.mutate({ formID: form.id })}
          disabled={reject.isPending}
        >
          Skip
        </Button>
      </div>
    </RequestCard>
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
        <Checkbox
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked === true)}
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
              <Checkbox
                checked={selected.includes(option.value)}
                onCheckedChange={(checked) => {
                  onChange(
                    checked === true
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value)
                  )
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (field.type === 'string' && field.options) {
    const current = typeof value === 'string' && value !== '' ? optionID(value) : CLEAR_SELECTION
    // Passing the label here stops Radix from mirroring the whole option
    // (label + description) into the closed trigger.
    const selectedLabel =
      typeof value === 'string'
        ? field.options.find((option) => option.value === value)?.label
        : undefined
    return (
      <div className="space-y-1">
        <span className="text-xs font-medium">{field.title ?? field.key}</span>
        {field.description && (
          <span className="block text-[11px] text-muted-foreground">{field.description}</span>
        )}
        <Select
          value={current}
          onValueChange={(next) =>
            onChange(next === CLEAR_SELECTION ? '' : next.slice(OPTION_PREFIX.length))
          }
        >
          <SelectTrigger className="h-8 w-full text-xs" aria-label={field.title ?? field.key}>
            <SelectValue placeholder="Select…">{selectedLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value={CLEAR_SELECTION}>Select…</SelectItem>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={optionID(option.value)}>
                {option.description ? (
                  <span className="flex flex-col">
                    <span>{option.label}</span>
                    <span className="text-[11px] text-muted-foreground">{option.description}</span>
                  </span>
                ) : (
                  option.label
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
          className="h-8 text-base md:text-xs"
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
        className="h-8 text-base md:text-xs"
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
