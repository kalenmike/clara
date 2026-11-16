import { useMemo, useRef, useState } from 'react'
import {
  MAX_THEME_IMPORT_BYTES,
  parseThemeFile,
  type ThemeDefinition,
  type ThemeParseError,
} from '@clara/theme'
import { importCustomTheme, saveColorTheme } from '@/features/theme/color-theme'

type ParsedTheme = { ok: true; value: ThemeDefinition } | { ok: false; errors: ThemeParseError[] }

/**
 * Import state for one dialog: paste or read a file, validate it, show errors
 * and a preview, then store the theme and select it.
 */
export function useThemeImport() {
  const [text, setText] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [importErrors, setImportErrors] = useState<ThemeParseError[] | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const parsed = useMemo<ParsedTheme | null>(() => {
    if (!text.trim()) return null
    try {
      return parseThemeFile(JSON.parse(text) as unknown)
    } catch {
      return {
        ok: false,
        errors: [{ path: 'file', message: 'The pasted text is not valid JSON.' }],
      }
    }
  }, [text])

  const validationErrors = parsed && !parsed.ok ? parsed.errors : []
  const errors =
    importErrors ?? (fileError ? [{ path: 'file', message: fileError }] : validationErrors)

  function updateText(value: string) {
    setText(value)
    setFileError(null)
    setImportErrors(null)
  }

  async function readFile(file: File | undefined) {
    if (!file) return
    setFileError(null)
    setImportErrors(null)

    if (file.size > MAX_THEME_IMPORT_BYTES) {
      setFileError(
        `The file is larger than ${Math.round(MAX_THEME_IMPORT_BYTES / 1024)} KB. ` +
          'Choose a smaller theme file.'
      )
      return
    }

    try {
      setText(await file.text())
    } catch {
      setFileError('The file could not be read.')
    }
  }

  function addTheme(): boolean {
    if (!parsed?.ok) return false

    let input: unknown
    try {
      input = JSON.parse(text) as unknown
    } catch {
      return false
    }

    const result = importCustomTheme(input)
    if (!result.ok) {
      setImportErrors(result.errors)
      return false
    }

    saveColorTheme(result.theme.id)
    return true
  }

  function reset() {
    setText('')
    setFileError(null)
    setImportErrors(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  return { fileInput, text, parsed, errors, updateText, readFile, addTheme, reset }
}
