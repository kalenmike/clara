import type { AttentionKind } from './attention'

type Note = {
  frequency: number
  /** Seconds after the motif starts. */
  start: number
  duration: number
  type?: OscillatorType
  gain?: number
}

const MOTIFS: Record<AttentionKind, Note[]> = {
  review: [
    { frequency: 659.25, start: 0, duration: 0.16 },
    { frequency: 523.25, start: 0.13, duration: 0.28 },
  ],
  question: [
    { frequency: 880, start: 0, duration: 0.12, type: 'triangle' },
    { frequency: 1046.5, start: 0.12, duration: 0.12, type: 'triangle' },
    { frequency: 880, start: 0.24, duration: 0.22, type: 'triangle' },
  ],
  plan: [
    { frequency: 523.25, start: 0, duration: 0.14 },
    { frequency: 659.25, start: 0.12, duration: 0.14 },
    { frequency: 783.99, start: 0.24, duration: 0.3 },
  ],
  error: [
    { frequency: 196, start: 0, duration: 0.22, type: 'square' },
    { frequency: 146.83, start: 0.2, duration: 0.38, type: 'square' },
  ],
}

/** A bright major arpeggio with a soft bell tail for finishing an action. */
const DONE_MOTIF: Note[] = [
  { frequency: 261.63, start: 0, duration: 0.3, gain: 0.4 },
  { frequency: 523.25, start: 0, duration: 0.14, type: 'triangle', gain: 0.7 },
  { frequency: 659.25, start: 0.07, duration: 0.14, type: 'triangle', gain: 0.75 },
  { frequency: 783.99, start: 0.14, duration: 0.16, type: 'triangle', gain: 0.8 },
  { frequency: 1046.5, start: 0.21, duration: 0.55, gain: 0.9 },
  { frequency: 1318.51, start: 0.21, duration: 0.42, gain: 0.35 },
  { frequency: 1567.98, start: 0.21, duration: 0.36, gain: 0.22 },
]

/** Two soft hammer taps, then a rising arpeggio that resolves bright. */
const START_WORK_MOTIF: Note[] = [
  { frequency: 130.81, start: 0, duration: 0.1, type: 'square', gain: 0.35 },
  { frequency: 196, start: 0.09, duration: 0.1, type: 'square', gain: 0.3 },
  { frequency: 392, start: 0.18, duration: 0.14, type: 'triangle', gain: 0.7 },
  { frequency: 523.25, start: 0.26, duration: 0.14, type: 'triangle', gain: 0.75 },
  { frequency: 659.25, start: 0.34, duration: 0.16, type: 'triangle', gain: 0.8 },
  { frequency: 783.99, start: 0.44, duration: 0.5, gain: 0.9 },
  { frequency: 1046.5, start: 0.44, duration: 0.42, gain: 0.28 },
]

const MIN_REPEAT_MS = 900

let context: AudioContext | null = null
let unlockBound = false
const lastPlayed = new Map<AttentionKind, number>()

function createContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!context || context.state === 'closed') {
    try {
      context = new AudioContext()
    } catch {
      return null
    }
  }
  return context
}

async function resumeAudio(): Promise<boolean> {
  const audio = createContext()
  if (!audio) return false
  if (audio.state !== 'running') {
    try {
      await audio.resume()
    } catch {
      return false
    }
  }
  return audio.state === 'running'
}

/** Unlock the audio context on the first gesture so later alerts can play. */
export function ensureSoundUnlock(): void {
  if (unlockBound || typeof window === 'undefined') return
  unlockBound = true

  const unlock = () => {
    void resumeAudio().then((ready) => {
      if (!ready) return
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
    })
  }

  window.addEventListener('pointerdown', unlock, true)
  window.addEventListener('keydown', unlock, true)
}

function schedule(audio: AudioContext, notes: Note[], volume: number): void {
  const start = audio.currentTime + 0.01
  const peak = Math.min(1, Math.max(0, volume)) * 0.12
  if (!Number.isFinite(peak) || peak <= 0) return

  for (const note of notes) {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    const noteStart = start + note.start
    const noteEnd = noteStart + note.duration
    const notePeak = peak * (note.gain ?? 1)

    oscillator.type = note.type ?? 'sine'
    oscillator.frequency.value = note.frequency
    gain.gain.setValueAtTime(0.0001, noteStart)
    gain.gain.exponentialRampToValueAtTime(notePeak, noteStart + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd)

    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.start(noteStart)
    oscillator.stop(noteEnd + 0.02)
  }
}

/**
 * Play a motif. Sounds are best effort: browsers can keep the audio context
 * suspended until the person interacts with the page.
 */
function playMotif(notes: Note[], volume: number): void {
  const audio = createContext()
  if (!audio) return

  if (audio.state === 'running') {
    schedule(audio, notes, volume)
    return
  }

  void audio.resume().then(
    () => {
      if (audio.state === 'running') schedule(audio, notes, volume)
    },
    () => {}
  )
}

/** Play the sound for an inbox state. */
export function playAttentionSound(kind: AttentionKind, volume: number, force = false): void {
  const now = Date.now()
  if (!force && now - (lastPlayed.get(kind) ?? 0) < MIN_REPEAT_MS) return
  lastPlayed.set(kind, now)
  playMotif(MOTIFS[kind], volume)
}

/** Play the completion chime for UI actions such as marking a session Done. */
export function playDoneSound(volume: number): void {
  playMotif(DONE_MOTIF, volume)
}

/** Play the start-work chime when a plan hands off to work. */
export function playStartWorkSound(volume: number): void {
  playMotif(START_WORK_MOTIF, volume)
}
