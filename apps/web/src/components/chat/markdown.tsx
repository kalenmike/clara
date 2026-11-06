import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useMarkdownSelection } from '@/components/chat/markdown-selection'
import { Button } from '@/components/ui/button'
import { headingLevel } from '@/features/chat/markdown-blocks'
import { cn } from '@/lib/utils'

type HastNode = {
  tagName?: string
  position?: {
    start?: { offset?: number | null; line?: number }
    end?: { offset?: number | null; line?: number }
  }
}

/** Source offsets travel with the rendered block so selection never touches text. */
function blockData(node: HastNode | undefined): Record<string, string | number> {
  const start = node?.position?.start?.offset
  const end = node?.position?.end?.offset
  if (typeof start !== 'number' || typeof end !== 'number') return {}

  const tag = node?.tagName ?? ''
  const level = headingLevel(tag)
  return {
    'data-md-start': start,
    'data-md-end': end,
    'data-md-tag': tag,
    ...(level ? { 'data-md-level': level } : {}),
  }
}

type CodeElementProps = { className?: string; children?: ReactNode }

/**
 * `pre` receives the rendered `<code>` element. Read the language class and raw
 * text from it so every fenced or indented block can render through CodeBlock,
 * tagged or not.
 */
function readCodeElement(children: ReactNode): { code: string; language?: string } {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement<CodeElementProps>(child)) return { code: '' }

  const language = /language-([^\s]+)/.exec(child.props.className ?? '')?.[1]
  return {
    code: String(child.props.children ?? '').replace(/\n$/, ''),
    language,
  }
}

function CodeBlock({
  code,
  language,
  data,
}: {
  code: string
  language?: string
  data?: Record<string, string | number>
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div {...data} className="group relative my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5 max-md:py-0">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {language || 'text'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 transition-opacity group-hover:opacity-100 max-md:size-11 max-md:opacity-100"
          onClick={copy}
        >
          {copied ? (
            <Check className="size-3 max-md:size-5" />
          ) : (
            <Copy className="size-3 max-md:size-5" />
          )}
          <span className="sr-only">Copy code</span>
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre p-3 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  p: ({ node, ...props }) => <p {...props} {...blockData(node)} />,
  h1: ({ node, ...props }) => <h1 {...props} {...blockData(node)} />,
  h2: ({ node, ...props }) => <h2 {...props} {...blockData(node)} />,
  h3: ({ node, ...props }) => <h3 {...props} {...blockData(node)} />,
  h4: ({ node, ...props }) => <h4 {...props} {...blockData(node)} />,
  h5: ({ node, ...props }) => <h5 {...props} {...blockData(node)} />,
  h6: ({ node, ...props }) => <h6 {...props} {...blockData(node)} />,
  ul: ({ node, ...props }) => <ul {...props} {...blockData(node)} />,
  ol: ({ node, ...props }) => <ol {...props} {...blockData(node)} />,
  blockquote: ({ node, ...props }) => <blockquote {...props} {...blockData(node)} />,
  table: ({ node, ...props }) => <table {...props} {...blockData(node)} />,
  hr: ({ node, ...props }) => <hr {...props} {...blockData(node)} />,
  pre: ({ node, children }) => {
    const { code, language } = readCodeElement(children)
    return <CodeBlock code={code} language={language} data={blockData(node)} />
  },
  code: ({ className: codeClassName, children: codeChildren }) => {
    // Block code: keep the parsed language class so `pre` can read it.
    // The element itself is replaced by CodeBlock.
    if (codeClassName?.startsWith('language-')) {
      return <code className={codeClassName}>{codeChildren}</code>
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{codeChildren}</code>
    )
  },
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  ),
}

export function Markdown({
  children,
  className,
  partIndex = 0,
}: {
  children: string
  className?: string
  /** Index of this text part in the assistant message, used by the inspector. */
  partIndex?: number
}) {
  const selection = useMarkdownSelection()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selection?.active) return
    return selection.register(partIndex, children, rootRef.current)
  }, [children, partIndex, selection])

  return (
    <div
      ref={rootRef}
      className={cn('markdown text-sm', selection?.active && 'markdown-selecting', className)}
      onPointerMove={selection?.active ? (event) => selection.move(partIndex, event) : undefined}
      onPointerLeave={selection?.active ? () => selection.leave(partIndex) : undefined}
      onClickCapture={
        selection?.active
          ? (event) => {
              const target = event.target
              if (!(target instanceof Element)) return
              if (!target.closest('a, button')) return
              event.preventDefault()
              event.stopPropagation()
              selection.select(partIndex, event)
            }
          : undefined
      }
      onClick={selection?.active ? (event) => selection.select(partIndex, event) : undefined}
      onKeyDown={selection?.active ? (event) => selection.key(partIndex, event) : undefined}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
