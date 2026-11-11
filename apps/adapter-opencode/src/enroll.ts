import { WebSocket } from 'ws'
import { HARNESS_PROTOCOL_VERSION } from '@clara/harness-protocol'
import {
  ReplayGuard,
  bytesToBase64Url,
  deriveSessionKeys,
  open,
  randomBytes,
  seal,
  utf8,
  type SessionKeys,
} from '@clara/crypto'
import {
  PROTOCOL_VERSION,
  RELAY_AUTH_PREFIX,
  RELAY_ROLE_PREFIX,
  RELAY_SUBPROTOCOL,
  isErrorFrame,
  isHelloFrame,
  isSealedFrame,
  type AdapterEnrolledState,
  type AdapterState,
  type ClaraState,
} from '@clara/shared-types'

export type EnrollmentInput = {
  wsUrl: string
  clientToken: string
  enrollId: string
  enrollToken: string
  harnessId: string
  kind: string
  label: string
  adapterId: string
  key: string
  adapterVersion: string
  harnessVersion?: string
  capabilities: Record<string, unknown>
  timeoutMs?: number
}

/**
 * Opens the one-time enrollment session, sends the stable harness identity,
 * and waits for the hub to create or reuse the connection. The long-lived
 * credential is then used by AdapterTransport.
 */
export async function enrollAdapter(input: EnrollmentInput): Promise<AdapterEnrolledState> {
  const protocols =
    input.clientToken && input.clientToken !== 'local'
      ? [
          RELAY_SUBPROTOCOL,
          `${RELAY_ROLE_PREFIX}client`,
          `${RELAY_AUTH_PREFIX}${input.clientToken}`,
        ]
      : undefined
  const socket = new WebSocket(input.wsUrl, protocols)
  const sid = bytesToBase64Url(randomBytes(16))
  const clientNonce = bytesToBase64Url(randomBytes(16))
  let keys: SessionKeys | undefined
  let sendSeq = 0
  const receive = new ReplayGuard()
  let settled = false
  let messageChain: Promise<void> = Promise.resolve()

  const timeout = setTimeout(() => {
    if (settled) return
    settled = true
    socket.terminate()
    reject(new Error('The hub did not answer the enrollment'))
  }, input.timeoutMs ?? 15_000)
  timeout.unref()

  let resolve!: (value: AdapterEnrolledState) => void
  let reject!: (cause: unknown) => void
  const result = new Promise<AdapterEnrolledState>((res, rej) => {
    resolve = res
    reject = rej
  })

  const finish = (value: AdapterEnrolledState) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    socket.close(1000, 'enrolled')
    resolve(value)
  }
  const fail = (cause: unknown) => {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    socket.close(1000, 'enrollment failed')
    reject(cause)
  }

  const send = async (payload: unknown) => {
    if (!keys) throw new Error('The enrollment session is not authenticated')
    const seq = sendSeq
    sendSeq += 1
    const box = await seal(keys.c2s, { sid, direction: 'c2s', seq }, utf8(JSON.stringify(payload)))
    socket.send(
      JSON.stringify({ t: 'sealed', v: PROTOCOL_VERSION, sid, seq, iv: box.iv, ct: box.ct })
    )
  }

  socket.on('open', () => {
    socket.send(
      JSON.stringify({
        t: 'hello',
        v: PROTOCOL_VERSION,
        sid,
        nonce: clientNonce,
        role: 'client',
        adapter: true,
        enrollId: input.enrollId,
      })
    )
  })

  socket.on('message', (data) => {
    const text = data.toString()
    messageChain = messageChain
      .then(async () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          return
        }

        if (isHelloFrame(parsed)) {
          if (parsed.sid !== sid || parsed.role !== 'agent') return
          keys = await deriveSessionKeys({
            key: input.enrollToken,
            sid,
            clientNonce,
            agentNonce: parsed.nonce,
          })
          await send({
            type: 'adapter.enroll',
            id: input.enrollId,
            harnessId: input.harnessId,
            kind: input.kind,
            label: input.label,
            credentialId: input.adapterId,
            key: input.key,
            adapterVersion: input.adapterVersion,
            protocolVersion: HARNESS_PROTOCOL_VERSION,
            ...(input.harnessVersion ? { harnessVersion: input.harnessVersion } : {}),
            capabilities: input.capabilities,
          })
          return
        }

        if (isErrorFrame(parsed)) {
          fail(new Error(parsed.message))
          return
        }

        if (!isSealedFrame(parsed) || !keys) return
        receive.check(parsed.seq)
        const plaintext = await open(
          keys.s2c,
          { sid, direction: 's2c', seq: parsed.seq },
          { iv: parsed.iv, ct: parsed.ct }
        )
        const payload = JSON.parse(new TextDecoder().decode(plaintext)) as ClaraState | AdapterState
        if (payload.type === 'adapter.enrolled') finish(payload)
      })
      .catch(fail)
  })

  socket.on('error', fail)
  socket.on('close', () => {
    if (!settled) fail(new Error('The hub closed the enrollment session'))
  })

  return result
}
