export interface FriendlyError {
  title: string
  detail?: string
  hint?: string
}

export type ErrorContext = 'host' | 'runtime' | 'start' | 'general'

export function friendlyError(message: string, context: ErrorContext = 'general'): FriendlyError {
  const text = message.trim()
  const lower = text.toLowerCase()

  if (
    lower.includes('no orchestration config found') ||
    lower.includes('config_missing') ||
    lower.includes('no index.yml')
  ) {
    return {
      title: 'The orchestrator cannot find this workspace',
      detail: text,
      hint:
        context === 'host'
          ? 'Use the path to the repository on this machine, for example /home/jet/Projects/clara.'
          : 'Use the path inside the orchestrator, usually the container mount /workspace/clara.',
    }
  }

  if (
    lower.includes('lib/std') ||
    lower.includes('enotdir') ||
    (lower.includes('enoent') && lower.includes('std'))
  ) {
    return {
      title: 'The orchestrator standard packages are stale',
      detail: text,
      hint: 'Rebuild the orchestrator image so /opt/clara/lib/std includes every package, or point CLARA_STD_DIR at the current lib/std.',
    }
  }

  if (
    lower.includes('missing or invalid token') ||
    lower.includes('unauthorized') ||
    /\b401\b/.test(text)
  ) {
    return {
      title: 'The orchestrator rejected the token',
      detail: text,
      hint: 'Restart Clara Lab with the same CLARA_ORCHESTRATION_TOKEN or CLARA_ORCHESTRATION_TOKEN_FILE as the running orchestrator.',
    }
  }

  if (lower.includes('enforcement_unavailable') || lower.includes('strict enforcement')) {
    return {
      title: 'This pipeline needs a live adapter',
      detail: text,
      hint: 'The lab can register the clara-lab adapter automatically when you start a strict run.',
    }
  }

  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('connect_failed') ||
    lower.includes('not connected') ||
    lower.includes('not running') ||
    lower.includes('unavailable')
  ) {
    return {
      title: 'The orchestrator is offline',
      detail: text,
      hint: 'Check CLARA_ORCHESTRATION_URL, start the orchestration service, then use Reconnect in Setup.',
    }
  }

  if (lower.includes('workspace') && lower.includes('no such file')) {
    return {
      title: 'The orchestrator cannot read this path',
      detail: text,
      hint: 'The orchestrator workspace is the path inside its filesystem or container, not the path on this machine.',
    }
  }

  return {
    title: context === 'start' ? 'The run could not start' : 'Something went wrong',
    detail: text,
  }
}

export function friendlyText(message: string, context: ErrorContext = 'general'): string {
  const friendly = friendlyError(message, context)
  return friendly.hint ? `${friendly.title}. ${friendly.hint}` : friendly.title
}
