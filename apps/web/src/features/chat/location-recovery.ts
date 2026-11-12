import type { QueryClient } from '@tanstack/react-query'
import type { ClaraProject, ClaraSession } from '@clara/api-contract'
import { toast } from 'sonner'
import { findProject, projectDefaultWorkspace } from '@/features/projects/use-projects'
import { describeConnectionError, type ClaraClient } from '@/lib/client'
import { queryKeys } from '@/lib/query-keys'

type LocationNotFoundError = {
  readonly _tag: 'LocationNotFoundError'
  readonly location: { readonly directory: string }
  readonly message: string
}

/** The server uses this error when a session's directory no longer exists. */
export function isMissingDirectoryError(error: unknown): error is LocationNotFoundError {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as { _tag?: unknown })._tag === 'LocationNotFoundError'
  )
}

/** A missing directory that has already been reported to the person. */
export class LocationRecoveryError extends Error {
  readonly reason: unknown

  constructor(message: string, reason: unknown) {
    super(message)
    this.name = 'LocationRecoveryError'
    this.reason = reason
  }
}

export function isLocationRecoveryError(error: unknown): error is LocationRecoveryError {
  return error instanceof LocationRecoveryError
}

type RecoveryContext = {
  client: ClaraClient
  queryClient: QueryClient
  sessionID: string
}

/**
 * Run a message-sending request, and if its session directory was deleted,
 * move the session back to the project's canonical workspace and retry once.
 *
 * The retry reuses the same call so prompts, drafts, commands, and synthetic
 * input all recover without each caller duplicating the flow.
 */
export async function withLocationRecovery<T>(
  context: RecoveryContext,
  send: () => Promise<T>
): Promise<T> {
  try {
    return await send()
  } catch (error) {
    if (!isMissingDirectoryError(error)) throw error
    return recoverMissingLocation(context, error, send)
  }
}

async function recoverMissingLocation<T>(
  { client, queryClient, sessionID }: RecoveryContext,
  error: LocationNotFoundError,
  retry: () => Promise<T>
): Promise<T> {
  const toastID = `missing-location:${sessionID}`
  try {
    const baseDirectory = await resolveBaseDirectory(client, queryClient, sessionID)
    if (!baseDirectory || baseDirectory === error.location.directory) {
      toast.error('Workspace folder is missing', {
        id: toastID,
        description: 'Clara could not find the project workspace to move this session back to.',
      })
      throw new LocationRecoveryError('Could not resolve the project workspace', error)
    }

    toast.info('Workspace folder is missing', {
      id: toastID,
      description: "Moving this session back to the project's main workspace and retrying.",
    })

    await client.session.move({ sessionID, directory: baseDirectory })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionID) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionID) })

    const result = await retry()
    toast.success('Workspace folder was reset', {
      id: toastID,
      description: 'Moved back to the project’s main workspace and retried.',
    })
    return result
  } catch (cause) {
    if (isLocationRecoveryError(cause)) throw cause
    toast.error('Could not reset the workspace folder', {
      id: toastID,
      description: describeConnectionError(cause),
    })
    throw new LocationRecoveryError('Could not reset the missing workspace', cause)
  }
}

async function resolveBaseDirectory(
  client: ClaraClient,
  queryClient: QueryClient,
  sessionID: string
): Promise<string | null> {
  const cachedSession = queryClient.getQueryData<ClaraSession>(queryKeys.session(sessionID))
  const session = cachedSession ?? (await client.session.get({ sessionID }))

  let projects = queryClient.getQueryData<ClaraProject[]>(queryKeys.projects)
  if (!projects || projects.length === 0) {
    projects = await client.project.list()
    queryClient.setQueryData(queryKeys.projects, projects)
  }

  const workspace = projectDefaultWorkspace(findProject(projects, session.projectID))
  return workspace?.canonical ?? workspace?.directory ?? null
}
