import type { parse } from 'csv-parse/sync'
import { type CategoryId, isCategoryId } from '#config/categories'

export const DIFFICULTIES = ['easy', 'hard', 'oos'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export type Label = {
  /** 1-based line in the labels file, for error messages */
  line: number
  file: string
  expected: CategoryId
  difficulty: Difficulty
  note: string
}

/**
 * csv-parse's sync parse function. Passed in by the eval command, which
 * imports it dynamically, so the production image does not need it.
 */
export type ParseCsv = typeof parse

const REQUIRED_COLUMNS = ['file', 'expected', 'difficulty'] as const

export class LabelsError extends Error {
  constructor(readonly problems: string[]) {
    super(`${problems.length} problem(s):\n${problems.map((p) => `- ${p}`).join('\n')}`)
    this.name = 'LabelsError'
  }
}

/**
 * Parses and validates labels.csv. All fields are trimmed. Every invalid
 * row is collected before failing, so one run lists all problems.
 */
export function parseLabels(
  text: string,
  parseCsv: ParseCsv,
  fileExists: (file: string) => boolean
): Label[] {
  type Parsed = { record: Record<string, string>; info: { lines: number } }
  let parsed: Parsed[]
  try {
    parsed = parseCsv<Parsed>(text, {
      columns: (header: string[]) => header.map((name) => name.trim()),
      bom: true,
      skip_empty_lines: true,
      trim: true,
      // Adds the line each record ends on, which stays right with blank lines.
      info: true,
    })
  } catch (error) {
    throw new LabelsError([`not valid CSV: ${(error as Error).message}`])
  }

  const records = parsed.map((entry) => entry.record)
  const header = Object.keys(records[0] ?? {})
  const missingColumns = REQUIRED_COLUMNS.filter((column) => !header.includes(column))
  if (records.length > 0 && missingColumns.length > 0) {
    throw new LabelsError([`missing column(s): ${missingColumns.join(', ')}`])
  }
  if (records.length === 0) {
    throw new LabelsError(['no rows'])
  }

  const problems: string[] = []
  const labels: Label[] = []
  const seen = new Map<string, number>()

  parsed.forEach(({ record, info }) => {
    const line = info.lines
    const file = (record.file ?? '').trim()
    const expected = (record.expected ?? '').trim()
    const difficulty = (record.difficulty ?? '').trim()
    const note = (record.note ?? '').trim()
    const rowProblems: string[] = []

    if (!file) {
      rowProblems.push('empty file')
    } else if (seen.has(file)) {
      rowProblems.push(`duplicate file "${file}" (also on line ${seen.get(file)})`)
    } else if (!fileExists(file)) {
      rowProblems.push(`missing file "${file}"`)
    }
    if (file && !seen.has(file)) seen.set(file, line)

    if (!isCategoryId(expected)) {
      rowProblems.push(`unknown category "${expected}"`)
    }
    if (!(DIFFICULTIES as readonly string[]).includes(difficulty)) {
      rowProblems.push(`unknown difficulty "${difficulty}" (expected ${DIFFICULTIES.join(', ')})`)
    }

    if (rowProblems.length > 0) {
      problems.push(...rowProblems.map((problem) => `line ${line}: ${problem}`))
    } else {
      labels.push({
        line,
        file,
        expected: expected as CategoryId,
        difficulty: difficulty as Difficulty,
        note,
      })
    }
  })

  if (problems.length > 0) {
    throw new LabelsError(problems)
  }
  return labels
}
