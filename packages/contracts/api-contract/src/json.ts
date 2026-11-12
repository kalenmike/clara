import { z } from 'zod'

export type ClaraJsonValue =
  null | boolean | number | string | ClaraJsonValue[] | { [key: string]: ClaraJsonValue }

export const claraJsonValueSchema: z.ZodType<ClaraJsonValue> = z
  .lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number(),
      z.string(),
      z.array(claraJsonValueSchema),
      z.record(z.string(), claraJsonValueSchema),
    ])
  )
  .meta({ id: 'ClaraJsonValue' })
