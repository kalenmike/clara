import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AtSign,
  BookOpen,
  Bot,
  ChevronDown,
  FileText,
  ListEnd,
  Paperclip,
  Play,
  Save,
  Send,
  SkipForward,
  Slash,
  Sparkles,
  X,
} from 'lucide-react'
import type { ClaraSessionInboxUser, ClaraSession } from '@clara/api-contract'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentPicker } from '@/components/chat/agent-picker'
import { ComposerRequestList } from '@/components/chat/composer-request-list'
import { ModelPicker, VariantPicker } from '@/components/chat/model-picker'
import { useAgents, useCommands, useReferences, useSkills } from '@/features/catalog/use-catalog'
import { primaryAgents } from '@/features/agents/default-agent'
import type { ComposerMenuMode } from '@/features/chat/composer-menu'
import {
  composerCanSend,
  composerSecondaryAction,
  initialFormAnswers,
  resolveComposerSelection,
  type ComposerRequestAnswers,
  type ComposerRequestSelection,
} from '@/features/chat/composer-requests'
import { isLocationRecoveryError } from '@/features/chat/location-recovery'
import { useModelVisibility } from '@/features/models/use-model-visibility'
import {
  useCancelInbox,
  useRunCommand,
  useSaveDraft,
  useSendPrompt,
  type PromptFile,
} from '@/features/chat/use-chat'
import {
  useRejectForm,
  useReplyForm,
  useSessionForms,
  type FormAnswerValue,
} from '@/features/chat/use-forms'
import { useStartWork } from '@/features/chat/use-start-work'
import { draftTitleFromText } from '@/features/sessions/draft-title'
import { useIsTouchDevice } from '@/hooks/use-is-touch-device'
import { describeConnectionError } from '@/lib/client'
import { readDraft, saveDraft } from '@/lib/storage'
import { useConnection } from '@/providers/connection-provider'
import { cn } from '@/lib/utils'

type MenuItem = {
  id: string
  label: string
  description?: string
  kind: 'command' | 'file' | 'agent' | 'skill' | 'reference'
}

export function Composer({
  session,
  sessionID,
  directory,
  harnessID,
  busy,
  disabled,
  active,
  focusSignal,
  modelRequest,
  agentRequest,
  menuMode,
  draft = false,
  planReady,
  startText,
  startFiles,
  onDraftChange,
  onSent,
  onCycleAgent,
}: {
  session: ClaraSession | undefined
  sessionID: string
  directory: string | undefined
  /** The harness that owns the session's catalog and file lookups. */
  harnessID?: string
  busy: boolean
  disabled?: boolean
  active: boolean
  focusSignal: number
  modelRequest: number
  agentRequest: number
  menuMode: ComposerMenuMode
  draft?: boolean
  planReady: boolean
  /** Text handed over by a forward action; local storage is the fallback. */
  startText?: string
  /** Attachments handed over by a forward action. */
  startFiles?: PromptFile[]
  onDraftChange: (hasDraft: boolean) => void
  onSent: () => void
  onCycleAgent: (direction: 1 | -1) => void
}) {
  const { client } = useConnection()
  const [text, setText] = useState(() => startText ?? readDraft(sessionID))
  const [files, setFiles] = useState<PromptFile[]>(() => startFiles ?? [])
  const [submittingForms, setSubmittingForms] = useState(false)
  const [selection, setSelection] = useState<ComposerRequestSelection>(null)
  const [formAnswers, setFormAnswers] = useState<ComposerRequestAnswers>({})
  const [touchedForms, setTouchedForms] = useState<Record<string, boolean>>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textRef = useRef(text)
  const sendRef = useRef(false)

  const commandsQuery = useCommands(harnessID)
  const agentsQuery = useAgents(harnessID)
  const skillsQuery = useSkills(directory, harnessID)
  const referencesQuery = useReferences(directory, harnessID)
  const { isModelHidden } = useModelVisibility(harnessID)
  const isTouchDevice = useIsTouchDevice()
  const sendPrompt = useSendPrompt(sessionID)
  const runCommand = useRunCommand(sessionID)
  const saveAsDraft = useSaveDraft(sessionID)
  const replyForm = useReplyForm(sessionID)
  const rejectForm = useRejectForm(sessionID)
  const cancelInbox = useCancelInbox(sessionID)
  const formsQuery = useSessionForms(sessionID)
  const startWork = useStartWork(sessionID)

  const commands = useMemo(() => commandsQuery.data ?? [], [commandsQuery.data])
  const agents = useMemo(() => primaryAgents(agentsQuery.data), [agentsQuery.data])
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data])
  const references = useMemo(() => referencesQuery.data ?? [], [referencesQuery.data])
  const forms = useMemo(() => formsQuery.data ?? [], [formsQuery.data])
  const activeSelection = resolveComposerSelection(forms, planReady, selection)
  const activeForm =
    activeSelection !== null && activeSelection !== 'none' && activeSelection.kind === 'form'
      ? forms.find((form) => form.id === activeSelection.formID)
      : undefined
  const planSelected =
    activeSelection !== null && activeSelection !== 'none' && activeSelection.kind === 'plan'
  const activeFormTouched = activeForm ? Boolean(touchedForms[activeForm.id]) : false
  const secondaryAction = composerSecondaryAction({
    hasActiveForm: activeForm != null,
    planSelected,
  })
  const hasText = text.trim().length > 0

  useEffect(() => {
    setFormAnswers((current) => {
      const next: ComposerRequestAnswers = {}
      let changed = false
      for (const form of forms) {
        const existing = current[form.id]
        next[form.id] = existing ?? initialFormAnswers(form.fields)
        if (!existing) changed = true
      }
      for (const id of Object.keys(current)) {
        if (!next[id]) changed = true
      }
      return changed ? next : current
    })
  }, [forms])

  useEffect(() => {
    setTouchedForms((current) => {
      const next: Record<string, boolean> = {}
      let changed = false
      for (const form of forms) {
        if (current[form.id]) next[form.id] = true
      }
      if (Object.keys(next).length !== Object.keys(current).length) changed = true
      return changed ? next : current
    })
  }, [forms])

  const token = useMemo(() => {
    const match = /(^|\s)([/@])([^\s/@]*)$/.exec(text)
    if (!match) return null
    return {
      kind: match[2] === '/' ? ('command' as const) : ('mention' as const),
      query: match[3],
      start: (match.index ?? 0) + match[1].length,
    }
  }, [text])

  const mentionQuery = token?.kind === 'mention' ? token.query : ''
  const deferredMention = useDeferredValue(mentionQuery)

  const fileQuery = useQuery({
    queryKey: ['file-find', directory, harnessID ?? 'none', deferredMention],
    queryFn: () =>
      client!.file.find({
        location: { directory },
        ...(harnessID ? { harnessID } : {}),
        query: deferredMention,
        type: 'file',
        limit: 8,
      }),
    enabled: Boolean(
      active && client && directory && token?.kind === 'mention' && deferredMention.length > 0
    ),
    select: (result) => result.data,
    staleTime: 10_000,
  })

  const items = useMemo<MenuItem[]>(() => {
    if (!token || dismissed) return []
    const query = token.query.toLowerCase()

    if (token.kind === 'command') {
      return commands
        .filter(
          (command) =>
            command.name.toLowerCase().includes(query) ||
            command.description?.toLowerCase().includes(query)
        )
        .map((command) => ({
          id: `command:${command.name}`,
          label: `/${command.name}`,
          description: command.description,
          kind: 'command',
        }))
    }

    const next: MenuItem[] = []
    for (const file of fileQuery.data ?? []) {
      next.push({ id: `file:${file.path}`, label: `@${file.path}`, kind: 'file' })
    }
    for (const agent of agents) {
      if (
        query &&
        !agent.id.toLowerCase().includes(query) &&
        !agent.name.toLowerCase().includes(query)
      ) {
        continue
      }
      next.push({
        id: `agent:${agent.id}`,
        label: `@${agent.id}`,
        description: agent.description,
        kind: 'agent',
      })
    }
    for (const skill of skills) {
      if (query && !skill.name.toLowerCase().includes(query)) continue
      next.push({
        id: `skill:${skill.id}`,
        label: `@${skill.name}`,
        description: skill.description ?? 'skill',
        kind: 'skill',
      })
    }
    for (const reference of references) {
      if (query && !reference.name.toLowerCase().includes(query)) continue
      next.push({
        id: `reference:${reference.path}`,
        label: `@${reference.name}`,
        description: reference.path,
        kind: 'reference',
      })
    }
    return next.slice(0, 12)
  }, [token, dismissed, commands, fileQuery.data, agents, skills, references])

  useEffect(() => {
    setActiveIndex(0)
  }, [items.length])

  useEffect(() => {
    setDismissed(false)
  }, [token?.query, token?.kind])

  useEffect(() => {
    textRef.current = text
    const timer = window.setTimeout(() => saveDraft(sessionID, text), 300)
    return () => window.clearTimeout(timer)
  }, [sessionID, text])

  useEffect(
    () => () => {
      saveDraft(sessionID, textRef.current)
    },
    [sessionID]
  )

  useEffect(() => {
    onDraftChange(text.trim().length > 0 || files.length > 0)
  }, [text, files, onDraftChange])

  useEffect(() => {
    if (modelRequest > 0) setModelOpen(true)
  }, [modelRequest])

  useEffect(() => {
    if (agentRequest > 0) setAgentOpen(true)
  }, [agentRequest])

  useEffect(() => {
    if (active) return
    setModelOpen(false)
    setAgentOpen(false)
    setDismissed(true)
  }, [active])

  useEffect(() => {
    if (!active || focusSignal === 0) return
    const frame = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [active, focusSignal])

  const selectItem = (item: MenuItem) => {
    if (!token) return
    setText(text.slice(0, token.start) + `${item.label} `)
    setDismissed(true)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const clear = () => {
    setText('')
    textRef.current = ''
    setFiles([])
    saveDraft(sessionID, '')
    onDraftChange(false)
    onSent()
  }

  const storedModelHidden = Boolean(
    session?.model && isModelHidden(session.model.providerID, session.model.id)
  )

  const releaseSend = () => {
    sendRef.current = false
    setSubmittingForms(false)
  }

  const submitActiveForm = async (): Promise<boolean> => {
    if (!activeForm) return true
    try {
      await replyForm.mutateAsync({
        formID: activeForm.id,
        answer: formAnswers[activeForm.id] ?? {},
      })
      return true
    } catch (cause) {
      releaseSend()
      if (isLocationRecoveryError(cause)) return false
      toast.error('Could not submit the form response', {
        description: describeConnectionError(cause),
      })
      return false
    }
  }

  const skipActiveForm = async (): Promise<boolean> => {
    if (!activeForm) return true
    try {
      await rejectForm.mutateAsync({ formID: activeForm.id })
      return true
    } catch (cause) {
      releaseSend()
      if (isLocationRecoveryError(cause)) return false
      toast.error('Could not skip the form', {
        description: describeConnectionError(cause),
      })
      return false
    }
  }

  /** The secondary Skip button discards the question without sending a message. */
  const skipQuestion = () => {
    if (
      disabled ||
      sendRef.current ||
      !activeForm ||
      rejectForm.isPending ||
      replyForm.isPending ||
      startWork.pending
    ) {
      return
    }
    rejectForm.mutate(
      { formID: activeForm.id },
      {
        onError: (cause) => {
          if (isLocationRecoveryError(cause)) return
          toast.error('Could not skip the form', {
            description: describeConnectionError(cause),
          })
        },
      }
    )
  }

  /** The secondary Start button hands off without a message. */
  const startPlan = async () => {
    if (disabled || sendRef.current || hasText || !planSelected) return
    sendRef.current = true
    const started = await startWork.start()
    releaseSend()
    if (started) clear()
  }

  const send = async (delivery: 'steer' | 'queue') => {
    const value = text.trim()
    if (disabled || sendRef.current) return
    if (
      !composerCanSend({
        text,
        formTouched: activeFormTouched,
        hasActiveForm: activeForm != null,
      }) ||
      (value && storedModelHidden)
    ) {
      return
    }

    sendRef.current = true
    setSubmittingForms(true)

    const command = value.startsWith('/')
      ? commands.find((item) => item.name === value.slice(1).split(/\s+/)[0])
      : undefined

    if (command) {
      if (activeForm) {
        if (activeFormTouched) {
          if (!(await submitActiveForm())) return
        } else if (!(await skipActiveForm())) {
          return
        }
      }

      const [, ...rest] = value.slice(1).split(/\s+/)
      runCommand.mutate(
        { name: command.name, text: rest.join(' '), files, delivery },
        {
          onSuccess: () => {
            releaseSend()
            clear()
          },
          onError: (cause) => {
            releaseSend()
            if (isLocationRecoveryError(cause)) return
            toast.error('Could not run the command', {
              description: describeConnectionError(cause),
            })
          },
        }
      )
      return
    }

    if (!activeForm) {
      sendPrompt.mutate(
        { text: value, files, delivery },
        {
          onSuccess: () => {
            releaseSend()
            clear()
          },
          onError: (cause) => {
            releaseSend()
            if (isLocationRecoveryError(cause)) return
            toast.error(
              delivery === 'queue' ? 'Could not queue the message' : 'Could not send the message',
              { description: describeConnectionError(cause) }
            )
          },
        }
      )
      return
    }

    if (!activeFormTouched) {
      if (!(await skipActiveForm())) return
      sendPrompt.mutate(
        { text: value, files, delivery },
        {
          onSuccess: () => {
            releaseSend()
            clear()
          },
          onError: (cause) => {
            releaseSend()
            if (isLocationRecoveryError(cause)) return
            toast.error(
              delivery === 'queue' ? 'Could not queue the message' : 'Could not send the message',
              { description: describeConnectionError(cause) }
            )
          },
        }
      )
      return
    }

    if (!value) {
      if (!(await submitActiveForm())) return
      releaseSend()
      clear()
      return
    }

    let sent: ClaraSessionInboxUser
    try {
      sent = await sendPrompt.mutateAsync({ text: value, files, delivery, resume: false })
    } catch (cause) {
      releaseSend()
      if (isLocationRecoveryError(cause)) return
      toast.error(
        delivery === 'queue' ? 'Could not queue the message' : 'Could not send the message',
        { description: describeConnectionError(cause) }
      )
      return
    }

    try {
      await replyForm.mutateAsync({
        formID: activeForm.id,
        answer: formAnswers[activeForm.id] ?? {},
      })
    } catch (cause) {
      let cancelled = true
      try {
        await cancelInbox.mutateAsync(sent.id)
      } catch {
        cancelled = false
      }
      releaseSend()
      if (isLocationRecoveryError(cause)) return
      toast.error('Could not submit the form response', {
        description: cancelled
          ? describeConnectionError(cause)
          : 'The message may already be queued. Check the session before sending it again.',
      })
      return
    }

    releaseSend()
    clear()
  }

  const submit = () => {
    void send('steer')
  }
  const queueMessage = () => {
    void send('queue')
  }

  const saveDraftMessage = () => {
    const value = text.trim()
    if (!value || disabled) return

    saveAsDraft.mutate(
      {
        text: value,
        files,
        title: session?.title?.trim() ? undefined : draftTitleFromText(value),
      },
      {
        onSuccess: ({ titleUpdated }) => {
          if (!titleUpdated) {
            toast.warning('Draft saved, but the title could not be updated')
          }
          clear()
        },
        onError: (cause) => {
          if (isLocationRecoveryError(cause)) return
          toast.error('Could not save the draft', {
            description: describeConnectionError(cause),
          })
        },
      }
    )
  }

  const updateFormAnswers = (formID: string, answers: Record<string, FormAnswerValue>) => {
    setFormAnswers((current) => ({ ...current, [formID]: answers }))
    setTouchedForms((current) => (current[formID] ? current : { ...current, [formID]: true }))
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (items.length > 0 && !dismissed) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (index + 1) % items.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => (index - 1 + items.length) % items.length)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !isTouchDevice) {
        event.preventDefault()
        const item = items[activeIndex]
        if (item) selectItem(item)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDismissed(true)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const item = items[activeIndex]
        if (item) selectItem(item)
        return
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      onCycleAgent(event.shiftKey ? -1 : 1)
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      // Touch keyboards have no Shift key, so Enter must insert a newline
      // there. The Send button submits on touch devices.
      if (isTouchDevice) return
      event.preventDefault()
      if (text.trim().length > 0) submit()
    }
  }

  const addFiles = async (fileList: FileList | File[]) => {
    const next: PromptFile[] = []
    for (const file of Array.from(fileList)) {
      const uri = await readAsDataUrl(file)
      next.push({ uri, name: file.name })
    }
    setFiles((current) => [...current, ...next])
  }

  const pending =
    sendPrompt.isPending ||
    runCommand.isPending ||
    saveAsDraft.isPending ||
    replyForm.isPending ||
    rejectForm.isPending ||
    startWork.pending ||
    submittingForms
  const sendPending =
    sendPrompt.isPending ||
    runCommand.isPending ||
    saveAsDraft.isPending ||
    replyForm.isPending ||
    submittingForms
  const canSend =
    composerCanSend({
      text,
      formTouched: activeFormTouched,
      hasActiveForm: activeForm != null,
    }) &&
    !pending &&
    !disabled &&
    (!hasText || !storedModelHidden)
  const sendHint = activeForm
    ? hasText
      ? 'Send the message and form answers'
      : activeFormTouched
        ? 'Send the form answers'
        : 'Answer the form or add a message'
    : planSelected
      ? hasText
        ? 'Send an adjustment to the plan'
        : 'Type a message to adjust the plan'
      : busy
        ? 'Send and steer the active run'
        : 'Send and start a run'
  const secondaryLabel = secondaryAction === 'skip' ? 'Skip' : 'Start'
  const secondaryHint =
    secondaryAction === 'skip'
      ? 'Skip this question'
      : secondaryAction === 'start'
        ? hasText
          ? 'Clear the message to start now'
          : 'Start work with the plan'
        : ''
  const secondaryPending = secondaryAction === 'skip' ? rejectForm.isPending : startWork.pending
  const secondaryDisabled =
    secondaryAction === null || pending || (secondaryAction === 'start' && hasText)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="text-xs text-muted-foreground">To</span>
        <ModelPicker
          session={session}
          harnessID={harnessID}
          open={modelOpen}
          onOpenChange={setModelOpen}
        />
        <VariantPicker session={session} harnessID={harnessID} />
        {storedModelHidden && (
          <span className="min-w-0 truncate text-[10px] text-amber-600 dark:text-amber-500">
            Pick a visible model
          </span>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {items.length > 0 && !dismissed && (
          <div className="absolute inset-x-2 bottom-2 z-20 max-h-56 overflow-y-auto rounded-xl border bg-popover shadow-xl">
            <div className="sticky top-0 border-b bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {token?.kind === 'command' ? 'Commands' : 'Mentions'}
            </div>
            <div className="p-1">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectItem(item)
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left',
                    index === activeIndex && 'bg-accent'
                  )}
                >
                  <MenuIcon kind={item.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{item.label}</span>
                    {item.description && (
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <ComposerRequestList
          forms={forms}
          planReady={planReady}
          selection={activeSelection}
          answers={formAnswers}
          touchedForms={touchedForms}
          pending={Boolean(disabled) || pending}
          onSelectionChange={setSelection}
          onAnswersChange={updateFormAnswers}
        />

        {files.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-1.5 border-b px-3 py-2 max-md:gap-2">
            {files.map((file, index) => (
              <Badge
                key={`${file.name}-${index}`}
                variant="secondary"
                className="gap-1 text-[10px] max-md:h-9 max-md:overflow-visible"
              >
                <FileText className="size-3" />
                {file.name ?? 'file'}
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  className="relative ml-1 rounded-full hover:bg-background/50 max-md:size-7 max-md:after:absolute max-md:after:-inset-2 max-md:after:content-['']"
                >
                  <X className="size-3 max-md:size-4" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files)
            if (pasted.length > 0) {
              event.preventDefault()
              void addFiles(pasted)
            }
          }}
          placeholder={
            draft
              ? 'Write your first message…  / commands   @ files'
              : 'Write your reply…  / commands   @ files'
          }
          disabled={disabled}
          className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 text-base outline-none placeholder:text-muted-foreground disabled:opacity-60 md:text-sm"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t px-2 py-2 max-md:gap-0.5 max-md:px-3 max-md:pb-[max(1.25rem,calc(0.5rem_+_env(safe-area-inset-bottom)))]">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="max-md:size-11"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-3.5 max-md:size-5" />
              <span className="sr-only">Attach file</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Attach file</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-1.5 text-[10px] text-muted-foreground max-md:h-11 max-sm:w-11"
          onClick={() => {
            setText((current) => `${current}/`)
            textareaRef.current?.focus()
          }}
        >
          <Slash className="size-3 max-md:size-5" />{' '}
          <span className="hidden sm:inline">commands</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-1.5 text-[10px] text-muted-foreground max-md:h-11 max-sm:w-11"
          onClick={() => {
            setText((current) => `${current}@`)
            textareaRef.current?.focus()
          }}
        >
          <AtSign className="size-3 max-md:size-5" />{' '}
          <span className="hidden sm:inline">files</span>
        </Button>

        <div className="ml-auto flex items-center gap-1 max-md:gap-0.5">
          <AgentPicker
            session={session}
            harnessID={harnessID}
            open={agentOpen}
            onOpenChange={setAgentOpen}
          />

          {secondaryAction && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 max-md:h-11"
                  onClick={secondaryAction === 'skip' ? skipQuestion : () => void startPlan()}
                  disabled={secondaryDisabled}
                >
                  {secondaryPending ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent max-md:size-5" />
                  ) : secondaryAction === 'skip' ? (
                    <SkipForward className="size-3.5 max-md:size-4" />
                  ) : (
                    <Play className="size-3.5 max-md:size-4" />
                  )}
                  {secondaryLabel}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{secondaryHint}</TooltipContent>
            </Tooltip>
          )}

          <div className="flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className={cn('h-8 gap-1 max-md:h-11', menuMode && hasText && 'rounded-r-none')}
                  onClick={submit}
                  disabled={!canSend}
                >
                  {sendPending ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent max-md:size-5" />
                  ) : (
                    <Send className="size-3.5 max-md:size-4" />
                  )}
                  Send
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sendHint}</TooltipContent>
            </Tooltip>

            {menuMode && hasText && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        className="h-8 rounded-l-none border-l border-primary-foreground/25 max-md:size-11"
                        disabled={!canSend}
                      >
                        <ChevronDown className="size-3.5 max-md:size-5" />
                        <span className="sr-only">Message options</span>
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    {menuMode === 'draft'
                      ? 'Save this message as a draft'
                      : 'Send this message as queued'}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="top" align="end" className="w-56">
                  {menuMode === 'draft' ? (
                    <DropdownMenuItem onSelect={saveDraftMessage}>
                      <Save className="size-3.5" />
                      <span className="flex-1">Save as draft</span>
                      <span className="text-[10px] text-muted-foreground">no reply</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={queueMessage}>
                      <ListEnd className="size-3.5" />
                      <span className="flex-1">Send as queued</span>
                      <span className="text-[10px] text-muted-foreground">after this run</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MenuIcon({ kind }: { kind: MenuItem['kind'] }) {
  if (kind === 'command') return <Slash className="mt-0.5 size-3.5 text-muted-foreground" />
  if (kind === 'file') return <FileText className="mt-0.5 size-3.5 text-muted-foreground" />
  if (kind === 'agent') return <Bot className="mt-0.5 size-3.5 text-muted-foreground" />
  if (kind === 'skill') return <Sparkles className="mt-0.5 size-3.5 text-muted-foreground" />
  return <BookOpen className="mt-0.5 size-3.5 text-muted-foreground" />
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
