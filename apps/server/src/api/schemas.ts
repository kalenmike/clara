import type { OpenAPIV3_1 } from 'openapi-types'
import { resolver } from 'hono-openapi'
import { apiErrorSchema } from '@clara/api-contract'

export const errorResponse: OpenAPIV3_1.ResponseObject = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: resolver(apiErrorSchema),
    },
  },
} as OpenAPIV3_1.ResponseObject

export function jsonResponse(schema: unknown, description = 'OK'): OpenAPIV3_1.ResponseObject {
  return {
    description,
    content: {
      'application/json': {
        schema,
      },
    },
  } as OpenAPIV3_1.ResponseObject
}

export function emptyResponse(description = 'No content'): OpenAPIV3_1.ResponseObject {
  return { description }
}

export function statusResponses(
  status: number,
  ok: OpenAPIV3_1.ResponseObject
): Record<string, OpenAPIV3_1.ResponseObject> {
  return {
    [status]: ok,
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    404: errorResponse,
    502: errorResponse,
    503: errorResponse,
  }
}

export function responses(
  ok: OpenAPIV3_1.ResponseObject
): Record<string, OpenAPIV3_1.ResponseObject> {
  return statusResponses(200, ok)
}
