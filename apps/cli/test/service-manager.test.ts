import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyPlan,
  detectService,
  installPlan,
  printService,
  serviceState,
  type ServiceOptions,
} from '../src/service-manager/index.ts'

let root: string
let options: ServiceOptions

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'clara-service-'))
  options = {
    homeDir: root,
    configDir: join(root, '.config', 'clara'),
    dataDir: join(root, '.local', 'share', 'clara'),
    cacheDir: join(root, '.cache', 'clara'),
    logDir: join(root, '.local', 'share', 'clara', 'logs'),
    execPath: join(root, 'bin', 'clara'),
  }
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('service detection', () => {
  it('uses the platform default', () => {
    expect(detectService({ platform: 'darwin' })).toBe('launchd')
    expect(detectService({ platform: 'win32' })).toBe('task-scheduler')
    expect(detectService({ platform: 'linux', run: () => 0, env: {} })).toBe('systemd')
    expect(
      detectService({ platform: 'linux', run: () => 1, env: { XDG_CURRENT_DESKTOP: 'GNOME' } })
    ).toBe('xdg-autostart')
    expect(detectService({ platform: 'linux', run: () => 1, env: {} })).toBe('none')
  })
})

describe('service plans', () => {
  it('writes a systemd unit that runs the supervisor', () => {
    const plan = installPlan('systemd', options)
    expect(plan.writes[0]?.content).toContain('ExecStart=')
    expect(plan.writes[0]?.content).toContain('__supervise')
    expect(plan.writes[0]?.content).toContain('CLARA_DATA_DIR')
    expect(plan.actions.map((action) => action.command)).toContain('systemctl')
  })

  it('writes a launch agent and a desktop entry', () => {
    expect(installPlan('launchd', options).writes[0]?.content).toContain('com.clara.stack')
    expect(installPlan('xdg-autostart', options).writes[0]?.content).toContain('Exec=')
  })

  it('applies a plan and runs its actions', () => {
    const calls: string[] = []
    const result = applyPlan(installPlan('systemd', options), (action) => {
      calls.push(`${action.command} ${action.args.join(' ')}`)
      return 0
    })
    const unit = join(root, '.config', 'systemd', 'user', 'clara.service')
    expect(existsSync(unit)).toBe(true)
    expect(readFileSync(unit, 'utf8')).toContain('__supervise')
    expect(calls.some((call) => call.startsWith('systemctl --user daemon-reload'))).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports a missing service as inactive', () => {
    expect(serviceState('xdg-autostart', options)).toEqual({
      kind: 'xdg-autostart',
      installed: false,
      active: false,
    })
  })

  it('prints the unit for hosts without a supported manager', () => {
    expect(printService('systemd', options)).toContain('ExecStart=')
    expect(printService('none', options)).toContain('No supported login service')
  })
})
