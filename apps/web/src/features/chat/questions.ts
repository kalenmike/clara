import type { JsonValue, SessionMessageAssistantTool } from '@opencode/client'
import type { SystemEvent } from '@/features/chat/system-events'
import { readRecord } from '@/features/chat/system-events'

type ParsedQuestion = {
  question: string
}

/** The built-in question tool is the one Clara renders as a form. */
export function isQuestionTool(part: {
  type: string
  name?: string
}): part is SessionMessageAssistantTool & { name: 'question' } {
  return part.type === 'tool' && part.name === 'question'
}

/**
 * Turn a completed question tool into a transcript event. The answers already
 * live in the tool result, so this needs no extra request and no model tokens.
 */
export function questionEvent(tool: SessionMessageAssistantTool): SystemEvent | null {
  if (tool.name !== 'question') return null
  const state = tool.state
  if (state.status === 'streaming' || state.status === 'running') return null

  const questions = readQuestions(state.input)
  if (questions.length === 0) return null

  const answers = readAnswers(state.metadata)
  const answered = answers.filter((answer) => answer.length > 0).length
  const dismissed = state.status === 'error'
  const label = dismissed
    ? 'Question dismissed'
    : answered === 0
      ? 'Question unanswered'
      : answered === 1
        ? 'Answered 1 question'
        : `Answered ${answered} questions`

  return {
    id: `question:${tool.id}`,
    kind: dismissed ? 'question-dismissed' : 'question-answer',
    label,
    detail: questionDetail(questions, answers),
    time: tool.time.completed ?? tool.time.created,
  }
}

function readQuestions(input: Record<string, JsonValue>): ParsedQuestion[] {
  const raw = input.questions
  if (!Array.isArray(raw)) return []

  const questions: ParsedQuestion[] = []
  for (const item of raw) {
    const record = readRecord(item)
    if (!record) continue
    const question = record.question
    if (typeof question !== 'string' || question.trim().length === 0) continue
    questions.push({ question: question.trim() })
  }
  return questions
}

function readAnswers(metadata: Record<string, JsonValue> | undefined): string[][] {
  const raw = metadata?.answers
  if (!Array.isArray(raw)) return []

  return raw.map((item) => {
    if (!Array.isArray(item)) return []
    return item.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
  })
}

function questionDetail(questions: ParsedQuestion[], answers: string[][]): string {
  return questions
    .map((question, index) => {
      const answer = answers[index]?.join(', ') || 'Unanswered'
      return `Q: ${question.question}\nA: ${answer}`
    })
    .join('\n\n')
}
