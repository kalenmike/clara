import type { ClaraForm } from '@clara/api-contract'
import { ChevronDown, CircleHelp, Sparkles } from 'lucide-react'
import { FormFields } from '@/components/chat/form-fields'
import {
  type ComposerRequestAnswers,
  type ComposerRequestSelection,
} from '@/features/chat/composer-requests'
import type { FormAnswerValue } from '@/features/chat/use-forms'
import { cn } from '@/lib/utils'

/**
 * Pending question forms and the plan-ready handoff, stacked above the
 * composer's editor. One request is selected at a time; clicking the selected
 * header returns to message-only mode. The composer's primary button carries
 * the action, so the cards do not repeat Submit, Skip, Start Work, or Adjust
 * Plan controls.
 */
export function ComposerRequestList({
  forms,
  planReady,
  selection,
  answers,
  touchedForms,
  pending,
  onSelectionChange,
  onAnswersChange,
}: {
  forms: readonly ClaraForm[]
  planReady: boolean
  selection: ComposerRequestSelection
  answers: ComposerRequestAnswers
  touchedForms: Readonly<Record<string, boolean>>
  pending: boolean
  onSelectionChange: (selection: ComposerRequestSelection) => void
  onAnswersChange: (formID: string, answers: Record<string, FormAnswerValue>) => void
}) {
  if (forms.length === 0 && !planReady) return null

  const selectedFormID =
    selection !== null && selection !== 'none' && selection.kind === 'form'
      ? selection.formID
      : null
  const planSelected = selection !== null && selection !== 'none' && selection.kind === 'plan'

  return (
    <div className="shrink-0 border-b bg-muted/20">
      <div className="max-h-64 space-y-1.5 overflow-y-auto p-2 md:max-h-72">
        {forms.map((form) => {
          const selected = selectedFormID === form.id
          const formAnswers = answers[form.id] ?? {}
          const fields = form.fields.filter((field) => !('hidden' in field && field.hidden))

          return (
            <section
              key={form.id}
              className={cn(
                'overflow-hidden rounded-lg border bg-card',
                selected && 'ring-1 ring-sky-500/40'
              )}
            >
              <button
                type="button"
                aria-expanded={selected}
                onClick={() =>
                  onSelectionChange(selected ? 'none' : { kind: 'form', formID: form.id })
                }
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
              >
                <CircleHelp className="size-4 shrink-0 text-sky-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{form.title}</span>
                {!selected && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {touchedForms[form.id] ? 'Answered' : 'Needs input'}
                  </span>
                )}
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    'size-4 shrink-0 text-muted-foreground transition-transform',
                    selected && 'rotate-180'
                  )}
                />
              </button>
              {selected && (
                <div className="border-t px-2.5 py-2.5">
                  <FormFields
                    fields={fields}
                    answers={formAnswers}
                    disabled={pending}
                    onChange={(key, value) =>
                      onAnswersChange(form.id, { ...formAnswers, [key]: value })
                    }
                  />
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Leave it empty to skip, or answer and Send.
                  </p>
                </div>
              )}
            </section>
          )
        })}

        {planReady && (
          <section
            className={cn(
              'overflow-hidden rounded-lg border bg-card',
              planSelected && 'ring-1 ring-sky-500/40'
            )}
          >
            <button
              type="button"
              aria-expanded={planSelected}
              onClick={() => onSelectionChange(planSelected ? 'none' : { kind: 'plan' })}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
            >
              <Sparkles className="size-4 shrink-0 text-sky-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">Plan is ready</span>
              {!planSelected && (
                <span className="shrink-0 text-[10px] text-muted-foreground">Start</span>
              )}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform',
                  planSelected && 'rotate-180'
                )}
              />
            </button>
            {planSelected && (
              <div className="border-t px-2.5 py-2.5">
                <p className="text-[11px] text-muted-foreground">
                  Start implements the plan now. Type a message below to send an adjustment first.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
