import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeScript } from '../src/execute.ts'
import type { RunnerTransport } from '../src/execute.ts'
import type { ScriptSpec, ScriptWorkOrder } from '../src/types.ts'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'clara-runner-test-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

function order(
  script: Partial<ScriptSpec>,
  inputs: ScriptWorkOrder['context']['inputs'] = []
): ScriptWorkOrder {
  return {
    run_id: 7,
    step_path: '2-build',
    name: 'build',
    kind: 'script',
    workspace,
    work_token: 'token',
    attempt: 1,
    max_attempts: 1,
    enforcement: 'observed',
    background: false,
    script: { command: 'echo hello', ...script },
    context: { prompt: 'the request', inputs, artifacts: [] },
  }
}

function recorder(): {
  transport: RunnerTransport
  completed: Array<{ result: unknown; exitCode: number }>
  failed: Array<{ error: string; exitCode?: number }>
  output: string[]
} {
  const completed: Array<{ result: unknown; exitCode: number }> = []
  const failed: Array<{ error: string; exitCode?: number }> = []
  const output: string[] = []
  return {
    completed,
    failed,
    output,
    transport: {
      heartbeat: async () => ({}),
      output: async (_order, _stream, chunk) => {
        output.push(chunk)
        return {}
      },
      complete: async (_order, result, exitCode) => {
        completed.push({ result, exitCode })
        return {}
      },
      fail: async (_order, error, exitCode) => {
        failed.push({ error, exitCode })
        return {}
      },
    },
  }
}

describe('executeScript', () => {
  it('runs a command and completes with text output', async () => {
    const calls = recorder()
    const outcome = await executeScript(calls.transport, order({ resultMode: 'text' }))
    expect(outcome).toEqual({ ok: true, exitCode: 0 })
    expect(calls.completed).toEqual([{ result: 'hello\n', exitCode: 0 }])
    expect(calls.failed).toEqual([])
  })

  it('parses JSON output in auto mode', async () => {
    const calls = recorder()
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write(JSON.stringify({ok:true}))"`
    const outcome = await executeScript(calls.transport, order({ command, resultMode: 'auto' }))
    expect(outcome.ok).toBe(true)
    expect(calls.completed[0]?.result).toEqual({ ok: true })
  })

  it('materializes declared inputs as files', async () => {
    const calls = recorder()
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write(require('fs').readFileSync(process.env.CLARA_INPUT_SPEC,'utf8'))"`
    const outcome = await executeScript(
      calls.transport,
      order({ command, resultMode: 'text' }, [
        { label: 'spec', path: '1-spec', name: 'spec', result: { title: 'Spec' } },
      ])
    )
    expect(outcome.ok).toBe(true)
    expect(calls.completed[0]?.result).toContain('"title": "Spec"')
  })

  it('materializes the failure context for a recovery script', async () => {
    const calls = recorder()
    const base = order({
      command: `${JSON.stringify(process.execPath)} -e "process.stdout.write(require('fs').readFileSync(process.env.CLARA_FAILURE,'utf8'))"`,
      resultMode: 'text',
    })
    const outcome = await executeScript(calls.transport, {
      ...base,
      context: {
        ...base.context,
        failure: { step: '2-build', attempt: 2, error: 'build failed', result: { ok: false } },
      },
    })
    expect(outcome.ok).toBe(true)
    expect(calls.completed[0]?.result).toContain('"error": "build failed"')
    expect(calls.completed[0]?.result).toContain('"attempt": 2')
  })

  it('fails with the exit code on a nonzero command', async () => {
    const calls = recorder()
    const outcome = await executeScript(calls.transport, order({ command: 'exit 2' }))
    expect(outcome).toMatchObject({ ok: false, exitCode: 2 })
    expect(calls.failed[0]?.exitCode).toBe(2)
    expect(calls.failed[0]?.error).toContain('exited with 2')
  })

  it('accepts an allowed nonzero exit code', async () => {
    const calls = recorder()
    const outcome = await executeScript(
      calls.transport,
      order({ command: 'exit 3', successCodes: [3], resultMode: 'exit' })
    )
    expect(outcome).toEqual({ ok: true, exitCode: 3 })
    expect(calls.completed[0]).toEqual({ result: { exit_code: 3 }, exitCode: 3 })
  })

  it('fails a json result that stdout cannot parse', async () => {
    const calls = recorder()
    const outcome = await executeScript(
      calls.transport,
      order({ command: 'echo not-json', resultMode: 'json' })
    )
    expect(outcome.ok).toBe(false)
    expect(calls.failed[0]?.error).toContain('not JSON')
  })

  it('kills a command that exceeds its timeout', async () => {
    const calls = recorder()
    const outcome = await executeScript(
      calls.transport,
      order({ command: 'sleep 5', timeoutSeconds: 0.2 })
    )
    expect(outcome.ok).toBe(false)
    expect(calls.failed[0]?.error).toContain('timed out')
  })

  it('truncates output past maxOutputBytes', async () => {
    const calls = recorder()
    const outcome = await executeScript(
      calls.transport,
      order({ command: 'printf 0123456789abcdef', maxOutputBytes: 10, resultMode: 'text' })
    )
    expect(outcome.ok).toBe(true)
    expect(String(calls.completed[0]?.result)).toContain('…[truncated]')
  })
})
