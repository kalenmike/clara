import { ApiRequestError } from './context.ts'

/**
 * A Clara project id must never reach the harness. If no harness record owns
 * it, say so instead of forwarding an id the harness cannot match, which would
 * look like an empty project.
 */
export function unmappedProjectError(projectId: string): ApiRequestError {
  return new ApiRequestError(
    409,
    'project_unmapped',
    'This project is not linked to a workspace on its harness.',
    { projectID: projectId }
  )
}
