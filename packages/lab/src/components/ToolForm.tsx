import type { FieldSpec, FieldValues } from '../lib/schema'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clara/ui/components/select'
import { Textarea } from '@clara/ui/components/textarea'
import { Input } from '@clara/ui/components/input'
import { Empty } from './Badge'
import { fieldHints, isFieldValues } from '../lib/schema'

export function ToolForm({
  fields,
  values,
  errors,
  disabled,
  onChange,
}: {
  fields: FieldSpec[]
  values: FieldValues
  errors: Record<string, string>
  disabled: boolean
  onChange: (path: string[], value: string) => void
}) {
  if (!fields.length) {
    return <Empty>This tool takes no arguments. Call it directly.</Empty>
  }
  return (
    <div className="schema-form">
      {fields.map((field) => (
        <SchemaField
          key={field.path.join('.')}
          field={field}
          values={values}
          errors={errors}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  )
}

function SchemaField({
  field,
  values,
  errors,
  disabled,
  onChange,
}: {
  field: FieldSpec
  values: FieldValues
  errors: Record<string, string>
  disabled: boolean
  onChange: (path: string[], value: string) => void
}) {
  const value = values[field.name]
  const error = errors[field.path.join('.')]

  if (field.kind === 'object') {
    const childValues = isFieldValues(value) ? value : {}
    return (
      <fieldset className="schema-object">
        <legend className="schema-label">
          {field.name}
          {field.required ? (
            <span className="schema-required" aria-hidden="true">
              *
            </span>
          ) : null}
        </legend>
        {field.description ? <p className="schema-desc">{field.description}</p> : null}
        <div className="schema-hint">{fieldHints(field).join(' · ')}</div>
        <div className="schema-children">
          {(field.children ?? []).map((child) => (
            <SchemaField
              key={child.path.join('.')}
              field={child}
              values={childValues}
              errors={errors}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
        </div>
      </fieldset>
    )
  }

  const id = domId(field)
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = error ? `${hintId} ${errorId}` : hintId

  return (
    <div className={`schema-field${error ? ' has-error' : ''}`}>
      <label className="schema-label" htmlFor={id}>
        {field.name}
        {field.required ? (
          <span className="schema-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {field.description ? <p className="schema-desc">{field.description}</p> : null}
      <FieldControl
        field={field}
        id={id}
        value={typeof value === 'string' ? value : ''}
        describedBy={describedBy}
        invalid={Boolean(error)}
        disabled={disabled}
        onChange={onChange}
      />
      <div className="schema-hint" id={hintId}>
        {fieldHints(field).join(' · ')}
      </div>
      {error ? (
        <div className="schema-error" id={errorId} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function FieldControl({
  field,
  id,
  value,
  describedBy,
  invalid,
  disabled,
  onChange,
}: {
  field: FieldSpec
  id: string
  value: string
  describedBy: string
  invalid: boolean
  disabled: boolean
  onChange: (path: string[], value: string) => void
}) {
  const update = (next: string) => onChange(field.path, next)
  const common = {
    id,
    value,
    disabled,
    'aria-describedby': describedBy,
    ...(invalid ? { 'aria-invalid': true as const } : {}),
  }

  switch (field.kind) {
    case 'boolean':
      return (
        <Select value={value || undefined} onValueChange={update} disabled={disabled}>
          <SelectTrigger id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
            <SelectValue placeholder="— not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectContent>
        </Select>
      )
    case 'enum':
      return (
        <Select value={value || undefined} onValueChange={update} disabled={disabled}>
          <SelectTrigger id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined}>
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {(field.enumValues ?? []).map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'integer':
    case 'number':
      return (
        <Input
          {...common}
          type="text"
          inputMode={field.kind === 'integer' ? 'numeric' : 'decimal'}
          spellCheck={false}
          onChange={(event) => update(event.target.value)}
        />
      )
    case 'array':
      return (
        <Textarea
          {...common}
          rows={3}
          placeholder="One value per line"
          spellCheck={false}
          onChange={(event) => update(event.target.value)}
        />
      )
    case 'json':
      return (
        <Textarea
          {...common}
          rows={3}
          placeholder="JSON value"
          spellCheck={false}
          onChange={(event) => update(event.target.value)}
        />
      )
    case 'string':
      return (
        <Input
          {...common}
          type="text"
          spellCheck={false}
          onChange={(event) => update(event.target.value)}
        />
      )
    default:
      return null
  }
}

function domId(field: FieldSpec): string {
  return `field-${field.path.join('-').replace(/[^a-zA-Z0-9_-]/g, '_')}`
}
