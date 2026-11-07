import { useMemo, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import type { FormInfo } from '@opencode/client'
import { FormFields } from '@/components/chat/form-fields'
import { RequestCard } from '@/components/chat/request-card'
import { Button } from '@/components/ui/button'
import { initialFormAnswers } from '@/features/chat/composer-requests'
import { useRejectForm, useReplyForm, useSessionForms } from '@/features/chat/use-forms'

/**
 * Top-of-thread fallback for sessions without a composer. Worker sessions keep
 * their question forms here; normal sessions carry them inside the composer.
 */
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
  const [answers, setAnswers] = useState(() => initialFormAnswers(form.fields))

  const fields = useMemo(
    () => form.fields.filter((field) => !('hidden' in field && field.hidden)),
    [form.fields]
  )

  const pending = reply.isPending || reject.isPending

  return (
    <RequestCard title={form.title} icon={CircleHelp} tone="sky">
      <FormFields
        fields={fields}
        answers={answers}
        disabled={pending}
        onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
      />
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="h-7 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
          onClick={() => reply.mutate({ formID: form.id, answer: answers })}
          disabled={pending}
        >
          Submit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs max-md:h-11 max-md:px-3 max-md:text-sm"
          onClick={() => reject.mutate({ formID: form.id })}
          disabled={pending}
        >
          Skip
        </Button>
      </div>
    </RequestCard>
  )
}
