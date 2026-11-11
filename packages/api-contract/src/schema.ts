import { z } from 'zod'

/**
 * Clara response objects keep unknown upstream fields. The hub owns the shape
 * it documents and consumes, but a harness may add fields before Clara models
 * them; dropping those fields would change the wire payload.
 */
export function passthroughObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).passthrough()
}
