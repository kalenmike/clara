import { z } from 'zod'

export const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true')

export const optionalBooleanQuery = booleanQuery.optional()

export const positiveIntQuery = z.coerce.number().int().positive()

export const nonNegativeIntQuery = z.coerce.number().int().nonnegative()

export const optionalPositiveIntQuery = positiveIntQuery.optional()

export const optionalNonNegativeIntQuery = nonNegativeIntQuery.optional()
