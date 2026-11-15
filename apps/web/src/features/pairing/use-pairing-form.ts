import { useState, type FormEvent } from 'react'
import { parsePairingInput, type PairingPayload } from '@clara/shared-types'
import { pairingInputError } from '@/lib/pairing'
import { useConnection } from '@/providers/connection-provider'

/**
 * One pairing attempt: the pasted code, the payload being connected, and the
 * scanner's own open and error state. The connect screen draws the result; the
 * attempt itself lives here so the page keeps no more than its layout.
 */
export function usePairingForm() {
  const { connect } = useConnection()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pairing, setPairing] = useState<PairingPayload | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  const pair = (payload: PairingPayload) => {
    setError(null)
    setPairing(payload)
    void connect(payload)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const payload = parsePairingInput(value)
    if (!payload) {
      setError(pairingInputError(value))
      return
    }
    pair(payload)
  }

  const changeValue = (next: string) => {
    setValue(next)
    if (error) setError(null)
  }

  const openScanner = () => {
    setScanError(null)
    setScanOpen(true)
  }

  const scan = (scanned: string): boolean => {
    const payload = parsePairingInput(scanned)
    if (!payload) {
      setScanError(pairingInputError(scanned))
      return false
    }
    setScanOpen(false)
    pair(payload)
    return true
  }

  return {
    value,
    changeValue,
    error,
    pairing,
    submit,
    scanOpen,
    setScanOpen,
    scanError,
    scan,
    openScanner,
    resetScanError: () => setScanError(null),
  }
}
