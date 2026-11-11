import type { ClaraFormField } from '@clara/api-contract'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { FormAnswerValue } from '@/features/chat/use-forms'

const CLEAR_SELECTION = '__clear__'
const OPTION_PREFIX = 'option:'

function optionID(value: string) {
  return `${OPTION_PREFIX}${value}`
}

/** Controlled renderer for a question form's visible fields. */
export function FormFields({
  fields,
  answers,
  onChange,
  disabled,
}: {
  fields: readonly ClaraFormField[]
  answers: Record<string, FormAnswerValue>
  onChange: (key: string, value: FormAnswerValue) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <Field
          key={field.key}
          field={field}
          value={answers[field.key]}
          onChange={(value) => onChange(field.key, value)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function Field({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ClaraFormField
  value: FormAnswerValue | undefined
  onChange: (value: FormAnswerValue) => void
  disabled?: boolean
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
          disabled={disabled}
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
                disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
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
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.type === 'string' ? field.placeholder : undefined}
        className="h-8 text-base md:text-xs"
      />
    </label>
  )
}
