import { CircleHelp, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formResponseSummary, type PendingFormResponse } from '@/features/chat/form-response'

export function FormResponseAttachment({
  response,
  onRemove,
  disabled,
}: {
  response: PendingFormResponse
  onRemove: () => void
  disabled?: boolean
}) {
  return (
    <Badge
      variant="secondary"
      className="max-w-full gap-1 text-[10px] max-md:h-9 max-md:overflow-visible"
    >
      <CircleHelp className="size-3 shrink-0" />
      <span className="truncate">{response.title}</span>
      <span className="shrink-0 text-muted-foreground">{formResponseSummary(response)}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${response.title} form response`}
        className="relative ml-1 shrink-0 rounded-full hover:bg-background/50 disabled:opacity-50 max-md:size-7 max-md:after:absolute max-md:after:-inset-2 max-md:after:content-['']"
      >
        <X className="size-3 max-md:size-4" />
      </button>
    </Badge>
  )
}
