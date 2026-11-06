import { describe, expect, it } from 'vitest'
import type { FormField, FormInfo } from '@opencode/client'
import { buildFormResponse, formResponseSummary } from './form-response'

function form(fields: FormField[]): FormInfo {
  return {
    id: 'form-1',
    sessionID: 'session-1',
    title: 'Deployment details',
    fields: fields as FormInfo['fields'],
  }
}

describe('buildFormResponse', () => {
  it('labels the answers from field titles and option labels', () => {
    const response = buildFormResponse(
      'session-1',
      form([
        { key: 'name', type: 'string', title: 'Service name' },
        {
          key: 'environment',
          type: 'string',
          title: 'Environment',
          options: [
            { value: 'prod', label: 'Production' },
            { value: 'staging', label: 'Staging' },
          ],
        },
        {
          key: 'regions',
          type: 'multiselect',
          title: 'Regions',
          options: [
            { value: 'eu', label: 'Europe' },
            { value: 'us', label: 'United States' },
          ],
        },
        { key: 'replicas', type: 'integer', title: 'Replicas' },
        { key: 'confirm', type: 'boolean', title: 'Confirmed' },
      ]),
      {
        name: 'checkout',
        environment: 'staging',
        regions: ['eu', 'us'],
        replicas: 3,
        confirm: false,
      }
    )

    expect(response.entries).toEqual([
      { label: 'Service name', value: 'checkout' },
      { label: 'Environment', value: 'Staging' },
      { label: 'Regions', value: 'Europe, United States' },
      { label: 'Replicas', value: '3' },
      { label: 'Confirmed', value: 'No' },
    ])
  })

  it('falls back to the field key and raw option value', () => {
    const response = buildFormResponse(
      'session-1',
      form([
        { key: 'target', type: 'string' },
        {
          key: 'mode',
          type: 'string',
          options: [{ value: 'fast', label: 'Fast' }],
        },
      ]),
      { target: 'api', mode: 'unknown' }
    )

    expect(response.entries).toEqual([
      { label: 'target', value: 'api' },
      { label: 'mode', value: 'unknown' },
    ])
  })

  it('keeps empty answers and skips hidden, external, and unanswered fields', () => {
    const response = buildFormResponse(
      'session-1',
      form([
        { key: 'notes', type: 'string', title: 'Notes' },
        { key: 'secret', type: 'string', title: 'Secret', hidden: true },
        { key: 'docs', type: 'external', title: 'Docs', url: 'https://example.com' },
        { key: 'unanswered', type: 'string', title: 'Unanswered' },
      ]),
      { notes: '', secret: 'hidden value' }
    )

    expect(response.entries).toEqual([{ label: 'Notes', value: '' }])
  })

  it('describes the number of answers', () => {
    const one = buildFormResponse('session-1', form([{ key: 'a', type: 'string' }]), {
      a: 'one',
    })
    const none = buildFormResponse('session-1', form([{ key: 'a', type: 'string' }]), {})

    expect(formResponseSummary(one)).toBe('1 answer')
    expect(formResponseSummary(none)).toBe('0 answers')
  })
})
