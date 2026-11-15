export type Column<T> = {
  header: string
  value: (row: T) => string
  align?: 'left' | 'right'
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export function visibleLength(text: string): number {
  return text.replace(ANSI, '').length
}

function pad(text: string, width: number, align: 'left' | 'right'): string {
  const missing = Math.max(0, width - visibleLength(text))
  return align === 'right' ? `${' '.repeat(missing)}${text}` : `${text}${' '.repeat(missing)}`
}

/** Render an aligned table. Values may carry color; widths ignore escape codes. */
export function renderTable<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  const cells = rows.map((row) => columns.map((column) => column.value(row)))
  const widths = columns.map((column, index) =>
    Math.max(visibleLength(column.header), ...cells.map((row) => visibleLength(row[index] ?? '')))
  )
  const header = columns
    .map((column, index) => pad(column.header, widths[index] ?? 0, column.align ?? 'left'))
    .join('  ')
  const body = cells.map((row) =>
    row
      .map((cell, index) => pad(cell, widths[index] ?? 0, columns[index]?.align ?? 'left'))
      .join('  ')
  )
  return [header, ...body].map((line) => line.trimEnd()).join('\n')
}
