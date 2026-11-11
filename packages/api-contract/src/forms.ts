import { z } from 'zod'
import { claraJsonValueSchema } from './json.ts'
import { passthroughObject } from './schema.ts'

const numberLikeSchema = z.union([
  z.number(),
  z.literal('Infinity'),
  z.literal('-Infinity'),
  z.literal('NaN'),
])

export const claraFormValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
])

export const claraFormOptionSchema = passthroughObject({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
}).meta({ id: 'ClaraFormOption' })

export const claraFormWhenSchema = passthroughObject({
  key: z.string(),
  op: z.enum(['eq', 'neq']),
  value: z.union([z.string(), z.number(), z.boolean()]),
}).meta({ id: 'ClaraFormWhen' })

const fieldBase = {
  key: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  when: z.array(claraFormWhenSchema).optional(),
}

export const claraFormStringFieldSchema = passthroughObject({
  ...fieldBase,
  type: z.literal('string'),
  format: z.enum(['email', 'uri', 'date', 'date-time']).optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  pattern: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.string().optional(),
  options: z.array(claraFormOptionSchema).optional(),
  custom: z.boolean().optional(),
}).meta({ id: 'ClaraFormStringField' })

export const claraFormNumberFieldSchema = passthroughObject({
  ...fieldBase,
  type: z.literal('number'),
  minimum: numberLikeSchema.optional(),
  maximum: numberLikeSchema.optional(),
  default: numberLikeSchema.optional(),
}).meta({ id: 'ClaraFormNumberField' })

export const claraFormIntegerFieldSchema = passthroughObject({
  ...fieldBase,
  type: z.literal('integer'),
  minimum: numberLikeSchema.optional(),
  maximum: numberLikeSchema.optional(),
  default: numberLikeSchema.optional(),
}).meta({ id: 'ClaraFormIntegerField' })

export const claraFormBooleanFieldSchema = passthroughObject({
  ...fieldBase,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
}).meta({ id: 'ClaraFormBooleanField' })

export const claraFormMultiselectFieldSchema = passthroughObject({
  ...fieldBase,
  type: z.literal('multiselect'),
  options: z.array(claraFormOptionSchema),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
  custom: z.boolean().optional(),
  default: z.array(z.string()).optional(),
}).meta({ id: 'ClaraFormMultiselectField' })

export const claraFormExternalFieldSchema = passthroughObject({
  key: z.string(),
  type: z.literal('external'),
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
}).meta({ id: 'ClaraFormExternalField' })

export const claraFormFieldSchema = z
  .discriminatedUnion('type', [
    claraFormStringFieldSchema,
    claraFormNumberFieldSchema,
    claraFormIntegerFieldSchema,
    claraFormBooleanFieldSchema,
    claraFormMultiselectFieldSchema,
    claraFormExternalFieldSchema,
  ])
  .meta({ id: 'ClaraFormField' })

export const claraFormFieldsSchema = z
  .tuple([claraFormFieldSchema])
  .rest(claraFormFieldSchema)
  .meta({ id: 'ClaraFormFields' })

export const claraFormSchema = passthroughObject({
  id: z.string(),
  sessionID: z.string(),
  title: z.string(),
  metadata: z.record(z.string(), claraJsonValueSchema).optional(),
  fields: claraFormFieldsSchema,
}).meta({ id: 'ClaraForm' })

export const claraFormListSchema = z.array(claraFormSchema)

export type ClaraFormValue = z.infer<typeof claraFormValueSchema>
export type ClaraFormOption = z.infer<typeof claraFormOptionSchema>
export type ClaraFormWhen = z.infer<typeof claraFormWhenSchema>
export type ClaraFormStringField = z.infer<typeof claraFormStringFieldSchema>
export type ClaraFormNumberField = z.infer<typeof claraFormNumberFieldSchema>
export type ClaraFormIntegerField = z.infer<typeof claraFormIntegerFieldSchema>
export type ClaraFormBooleanField = z.infer<typeof claraFormBooleanFieldSchema>
export type ClaraFormMultiselectField = z.infer<typeof claraFormMultiselectFieldSchema>
export type ClaraFormExternalField = z.infer<typeof claraFormExternalFieldSchema>
export type ClaraFormField = z.infer<typeof claraFormFieldSchema>
export type ClaraFormFields = z.infer<typeof claraFormFieldsSchema>
export type ClaraForm = z.infer<typeof claraFormSchema>
