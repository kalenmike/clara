import { z } from 'zod'

export const gitCommitSchema = z.object({
  hash: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  authoredAt: z.string(),
  subject: z.string(),
  body: z.string(),
})

export type GitCommit = z.infer<typeof gitCommitSchema>

export const gitLogQuerySchema = z.object({
  directory: z.string().min(1),
  harnessID: z.string().min(1).optional(),
  since: z.coerce.number().int().nonnegative(),
  until: z.coerce.number().int().nonnegative().optional(),
})

export type GitLogQuery = z.infer<typeof gitLogQuerySchema>
