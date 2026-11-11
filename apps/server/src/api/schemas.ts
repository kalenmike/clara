import type { OpenAPIV3_1 } from 'openapi-types'
import { resolver } from 'hono-openapi'
import { apiErrorSchema, openApiSchemas } from '@clara/api-contract'

export const schemas = openApiSchemas

export const errorResponse: OpenAPIV3_1.ResponseObject = {
  description: 'Error response',
  content: {
    'application/json': {
      schema: resolver(apiErrorSchema),
    },
  },
} as OpenAPIV3_1.ResponseObject

export function ref(name: string): OpenAPIV3_1.ReferenceObject {
  return { $ref: `#/components/schemas/${name}` }
}

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

export function arrayOf(
  item: OpenAPIV3_1.SchemaObject | OpenAPIV3_1.ReferenceObject
): OpenAPIV3_1.SchemaObject {
  return { type: 'array', items: item }
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
