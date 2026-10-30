import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AtSign, BookOpen, Bot, FileText, Paperclip, Send, Slash, Sparkles, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAgents, useCommands, useReferences, useSkills } from '@/features/catalog/use-catalog'
import { useRunCommand, useSendPrompt, type PromptFile } from '@/features/chat/use-chat'
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
  sessionID,
  directory,
  busy,
  disabled,
}: {
  sessionID: string
  directory: string | undefined
  busy: boolean
  disabled?: boolean
}) {
  const { client } = useConnection()
  const [text, setText] = useState(() => readDraft(sessionID))
  const [files, setFiles] = useState<PromptFile[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const commandsQuery = useCommands()
  const agentsQuery = useAgents()
  const skillsQuery = useSkills(directory)
  const referencesQuery = useReferences(directory)
  const sendPrompt = useSendPrompt(sessionID)
  const runCommand = useRunCommand(sessionID)

  const commands = useMemo(() => commandsQuery.data ?? [], [commandsQuery.data])
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.hidden),
    [agentsQuery.data]
  )
  const skills = useMemo(() => skillsQuery.data ?? [], [skillsQuery.data])
  const references = useMemo(() => referencesQuery.data ?? [], [referencesQuery.data])

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
    queryKey: ['file-find', directory, deferredMention],
    queryFn: () =>
      client!.file.find({
        location: { directory },
        query: deferredMention,
        type: 'file',
        limit: 8,
      }),
    enabled: Boolean(
      client && directory && token?.kind === 'mention' && deferredMention.length > 0
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
    const timer = window.setTimeout(() => saveDraft(sessionID, text), 300)
    return () => window.clearTimeout(timer)
  }, [sessionID, text])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }, [text])

  const selectItem = (item: MenuItem) => {
    if (!token) return
    const replacement = item.kind === 'command' ? `${item.label} ` : `${item.label} `
    setText(text.slice(0, token.start) + replacement)
    setDismissed(true)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const submit = () => {
    const value = text.trim()
    if (!value || disabled) return

    if (value.startsWith('/')) {
      const [name, ...rest] = value.slice(1).split(/\s+/)
      const command = commands.find((item) => item.name === name)
      if (command) {
        runCommand.mutate({ name: command.name, text: rest.join(' '), files })
        setText('')
        setFiles([])
        saveDraft(sessionID, '')
        return
      }
    }

    sendPrompt.mutate(
      { text: value, files, delivery: busy ? 'queue' : undefined },
      {
        onSuccess: () => {
          setText('')
          setFiles([])
          saveDraft(sessionID, '')
        },
      }
    )
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
      if (event.key === 'Enter' && !event.shiftKey) {
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

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
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

  const pending = sendPrompt.isPending || runCommand.isPending

  return (
    <div className="shrink-0 border-t bg-background p-2 md:p-3">
      {items.length > 0 && !dismissed && (
        <div className="mx-auto mb-2 max-w-3xl overflow-hidden rounded-xl border bg-popover shadow-lg">
          <div className="border-b px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {token?.kind === 'command' ? 'Commands' : 'Mentions'}
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
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

      <div className="mx-auto max-w-3xl rounded-xl border bg-card shadow-sm focus-within:border-foreground/25">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b px-3 py-2">
            {files.map((file, index) => (
              <Badge
                key={`${file.name}-${index}`}
                variant="secondary"
                className="gap-1 text-[10px]"
              >
                <FileText className="size-3" />
                {file.name ?? 'file'}
                <button
                  type="button"
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  className="ml-1 rounded-full hover:bg-background/50"
                >
                  <X className="size-3" />
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
          placeholder="Ask anything…  / commands   @ files"
          rows={1}
          disabled={disabled}
          className="block max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-3 py-3 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
        />

        <div className="flex items-center gap-1 px-2 pb-2">
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-3.5" />
            <span className="sr-only">Attach file</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => {
              setText((current) => `${current}/`)
              textareaRef.current?.focus()
            }}
          >
            <Slash className="size-3" /> commands
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-1.5 text-[10px] text-muted-foreground"
            onClick={() => {
              setText((current) => `${current}@`)
              textareaRef.current?.focus()
            }}
          >
            <AtSign className="size-3" /> files
          </Button>

          <span className="ml-auto hidden text-[10px] text-muted-foreground sm:block">
            Enter to send · Shift+Enter for newline
          </span>

          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1"
              onClick={submit}
              disabled={!text.trim() || pending}
            >
              <Send className="size-3.5" /> Queue
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1"
              onClick={submit}
              disabled={!text.trim() || pending}
            >
              {pending ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Send className="size-3.5" />
              )}
              Send
            </Button>
          )}
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
