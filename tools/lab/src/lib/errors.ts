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
      title: 'The orchestrator cannot find the config file',
      detail: text,
      hint:
        context === 'host'
          ? 'Check the custom config path. Without one, Clara uses the config bundled with the engine.'
          : 'Check CLARA_ORCHESTRATION_CONFIG on the service, or remove it to use the bundled default.',
    }
  }

  if (lower.includes('workspace_missing')) {
    return {
      title: 'The orchestrator cannot see this workspace',
      detail: text,
      hint:
        context === 'host'
          ? 'Choose a directory that exists on this machine.'
          : 'Set CLARA_ORCHESTRATION_WORKSPACE to a path that exists inside the service, or fix the volume mount.',
    }
  }

  if (lower.includes('enotdir') || (lower.includes('enoent') && lower.includes('std'))) {
    return {
      title: 'The orchestrator standard packages are missing',
      detail: text,
      hint: 'Rebuild the orchestrator and Lab so each bundles the current standard packages.',
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
    lower.includes('directory picker') ||
    lower.includes('cannot open display') ||
    lower.includes('picker is not available')
  ) {
    return {
      title: 'Could not open the file picker',
      detail: text,
      hint: 'Install zenity or kdialog on Linux, or type the path into the field instead.',
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
      hint: 'The orchestrator reports the path inside its own filesystem or container. Set CLARA_ORCHESTRATION_WORKSPACE on the service to match its mount.',
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
