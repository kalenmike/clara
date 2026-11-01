import type { SessionMessageAssistant, SessionMessageInfo } from '@opencode/client'
import type { PromptFile } from '@/features/chat/use-chat'
import { isForkableMessage } from '@/features/sessions/fork'
import { draftTitleFromText } from '@/features/sessions/draft-title'

/** The text Clara can carry into a new draft from a message. */
export function forwardText(message: SessionMessageInfo): string {
  if (message.type === 'user') return message.text
  if (message.type !== 'assistant') return ''
  return assistantText(message)
}

/** User attachments mapped to the reply window's file shape. */
export function forwardFiles(message: SessionMessageInfo): PromptFile[] {
  if (message.type !== 'user') return []
  return (message.files ?? []).flatMap((file) => {
    const uri = file.source.type === 'uri' ? file.source.uri : inlineFileURL(file.data, file.mime)
    return uri ? [{ uri, name: file.name }] : []
  })
}

export function canForwardMessage(message: SessionMessageInfo): boolean {
  if (!isForkableMessage(message)) return false
  return forwardText(message).trim().length > 0 || forwardFiles(message).length > 0
}

/** A short draft title derived from the forwarded content. */
export function forwardTitle(message: SessionMessageInfo): string {
  const text = forwardText(message)
  return draftTitleFromText(text) || forwardFiles(message)[0]?.name || 'Forwarded message'
}

export function assistantText(message: SessionMessageAssistant): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n')
    .trim()
}

function inlineFileURL(data: string, mime: string): string {
  if (data.startsWith('data:')) return data
  return `data:${mime};base64,${data}`
}
