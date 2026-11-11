import { z } from 'zod'
import {
  claraAgentListOutputSchema,
  claraCommandListOutputSchema,
  claraEventSchema,
  claraFileFindOutputSchema,
  claraFormSchema,
  claraLocationSchema,
  claraModelListOutputSchema,
  claraPermissionRequestListOutputSchema,
  claraProjectSchema,
  claraProviderListOutputSchema,
  claraReferenceListOutputSchema,
  claraServerInfoSchema,
  claraSessionActiveOutputSchema,
  claraSessionInboxCompactionSchema,
  claraSessionInboxInfoSchema,
  claraSessionInboxSyntheticSchema,
  claraSessionInboxUserSchema,
  claraSessionInterruptResponseSchema,
  claraSessionMessageSchema,
  claraSessionMessagesResponseSchema,
  claraSessionSchema,
  claraSessionsResponseSchema,
  claraSkillListOutputSchema,
  claraVcsBaseOutputSchema,
  claraVcsDiffOutputSchema,
  claraVcsGetOutputSchema,
  claraVcsStatusOutputSchema,
  claraWorktreeSchema,
} from '@clara/api-contract'
import { AdapterError } from './errors.ts'

function parser<T>(schema: z.ZodType<T>, label: string) {
  return (value: unknown): T => {
    const result = schema.safeParse(value)
    if (!result.success) {
      throw new AdapterError(
        502,
        'upstream_invalid',
        `OpenCode returned an invalid ${label}`,
        result.error.issues
      )
    }
    return result.data
  }
}

export const parseClaraProject = parser(claraProjectSchema, 'project')
export const parseClaraProjects = parser(z.array(claraProjectSchema), 'project list')
export const parseClaraSession = parser(claraSessionSchema, 'session')
export const parseClaraSessions = parser(claraSessionsResponseSchema, 'session list')
export const parseClaraSessionMessage = parser(claraSessionMessageSchema, 'message')
export const parseClaraSessionMessages = parser(z.array(claraSessionMessageSchema), 'message list')
export const parseClaraSessionMessagesResponse = parser(
  claraSessionMessagesResponseSchema,
  'message page'
)
export const parseClaraSessionActive = parser(claraSessionActiveOutputSchema, 'active session map')
export const parseClaraSessionInboxUser = parser(claraSessionInboxUserSchema, 'queued prompt')
export const parseClaraSessionInboxSynthetic = parser(
  claraSessionInboxSyntheticSchema,
  'queued synthetic prompt'
)
export const parseClaraSessionInboxCompaction = parser(
  claraSessionInboxCompactionSchema,
  'queued compaction'
)
export const parseClaraSessionInbox = parser(z.array(claraSessionInboxInfoSchema), 'session inbox')
export const parseClaraSessionInterrupt = parser(
  claraSessionInterruptResponseSchema,
  'interrupt result'
)
export const parseClaraForm = parser(claraFormSchema, 'form')
export const parseClaraForms = parser(z.array(claraFormSchema), 'form list')
export const parseClaraPermissionRequests = parser(
  claraPermissionRequestListOutputSchema,
  'permission requests'
)
export const parseClaraAgentList = parser(claraAgentListOutputSchema, 'agent list')
export const parseClaraModelList = parser(claraModelListOutputSchema, 'model list')
export const parseClaraProviderList = parser(claraProviderListOutputSchema, 'provider list')
export const parseClaraCommandList = parser(claraCommandListOutputSchema, 'command list')
export const parseClaraSkillList = parser(claraSkillListOutputSchema, 'skill list')
export const parseClaraReferenceList = parser(claraReferenceListOutputSchema, 'reference list')
export const parseClaraFiles = parser(claraFileFindOutputSchema, 'file matches')
export const parseClaraLocation = parser(claraLocationSchema, 'location')
export const parseClaraServerInfo = parser(claraServerInfoSchema, 'server information')
export const parseClaraVcs = parser(claraVcsGetOutputSchema, 'VCS information')
export const parseClaraVcsBase = parser(claraVcsBaseOutputSchema, 'VCS base')
export const parseClaraVcsStatus = parser(claraVcsStatusOutputSchema, 'VCS status')
export const parseClaraVcsDiff = parser(claraVcsDiffOutputSchema, 'VCS diff')
export const parseClaraWorktrees = parser(z.array(claraWorktreeSchema), 'worktree list')
export const parseClaraEvent = parser(claraEventSchema, 'event')
