import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultServices, reportedService, resolveServices } from '../src/service/lifecycle.ts'
import { ordered, SPECS, START_ORDER, STOP_ORDER } from '../src/service/specs.ts'
import { resolvePorts } from '../src/ports.ts'

describe('service selection', () => {
  it('starts engine before lab before hub before web', () => {
    expect(defaultServices()).toEqual(['engine', 'lab', 'hub', 'web'])
    expect(ordered(['web', 'engine', 'lab', 'hub'], START_ORDER)).toEqual([
      'engine',
      'lab',
      'hub',
      'web',
    ])
    expect(ordered(['web', 'engine', 'lab', 'hub'], STOP_ORDER)).toEqual([
      'web',
      'hub',
      'lab',
      'engine',
    ])
  })

  it('splits comma lists and drops unknown values', () => {
    expect(resolveServices(['hub,web'])).toEqual(['hub', 'web'])
    expect(resolveServices(['lab'])).toEqual(['lab'])
    expect(resolveServices(['bogus'])).toEqual([])
    expect(resolveServices([])).toEqual([])
  })
})

describe('service endpoints', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('describes the lab as a service with its own health route', () => {
    const ports = resolvePorts({})
    expect(SPECS.lab.serviceId).toBe('clara-lab')
    expect(SPECS.lab.healthPath).toBe('/api/health')
    expect(SPECS.lab.port(ports)).toBe(8791)
    expect(SPECS.lab.url(ports)).toBe('http://127.0.0.1:8791')
  })

  it('points the hub bridge at the supervised lab unless it is configured', () => {
    vi.stubEnv('CLARA_LAB_URL', '')
    const ports = resolvePorts({ CLARA_LAB_PORT: '9101' })
    expect(SPECS.hub.env(ports).CLARA_LAB_URL).toBe('http://127.0.0.1:9101')

    vi.stubEnv('CLARA_LAB_URL', 'off')
    expect(SPECS.hub.env(ports).CLARA_LAB_URL).toBe('off')

    vi.stubEnv('CLARA_LAB_URL', 'http://lab.example:8791')
    expect(SPECS.hub.env(ports).CLARA_LAB_URL).toBe('http://lab.example:8791')
  })

  it('points the lab at the supervised engine unless it is configured', () => {
    vi.stubEnv('CLARA_ENGINE_URL', '')
    vi.stubEnv('CLARA_ORCHESTRATION_URL', '')
    const ports = resolvePorts({ CLARA_ENGINE_PORT: '9102' })
    expect(SPECS.lab.env(ports).CLARA_ENGINE_URL).toBe('http://127.0.0.1:9102')

    vi.stubEnv('CLARA_ENGINE_URL', 'http://engine.example:8789')
    expect(SPECS.lab.env(ports).CLARA_ENGINE_URL).toBe('http://engine.example:8789')
  })

  it('reads the lab port from the environment', () => {
    expect(resolvePorts({ CLARA_LAB_PORT: '9200' }).lab).toBe(9200)
    expect(resolvePorts({ CLARA_LAB_PORT: 'nope' }).lab).toBe(8791)
  })
})

describe('reported service identity', () => {
  it('reads a version and protocol from a health body', () => {
    expect(reportedService({ version: '1.2.3', protocol: 4 })).toEqual({
      version: '1.2.3',
      protocol: 4,
    })
  })

  it('keeps only valid values', () => {
    expect(reportedService({ version: '', protocol: 0 })).toEqual({})
    expect(reportedService({ version: 4, protocol: '4' })).toEqual({})
    expect(reportedService({ version: '1.2.3' })).toEqual({ version: '1.2.3' })
    expect(reportedService(undefined)).toEqual({})
  })
})
