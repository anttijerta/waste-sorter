import { describe, expect, it } from 'vitest'
import { parse } from 'csv-parse/sync'
import { LabelsError, parseLabels } from '#eval/labels'

const exists = (files: string[]) => (file: string) => files.includes(file)

function problemsOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof LabelsError) return error.problems
    throw error
  }
  throw new Error('expected a LabelsError')
}

describe('parseLabels', () => {
  it('parses quoted fields with commas, trims every field and handles a BOM', () => {
    const csv =
      '﻿file , expected,difficulty,note\n' +
      ' IMG_1.jpg , glass ,  easy ,"juomalasi, ei lasinkeräykseen"\n' +
      'IMG_2.jpg,unrecognized,oos,  pantti \n'

    expect(parseLabels(csv, parse, exists(['IMG_1.jpg', 'IMG_2.jpg']))).toEqual([
      {
        line: 2,
        file: 'IMG_1.jpg',
        expected: 'glass',
        difficulty: 'easy',
        note: 'juomalasi, ei lasinkeräykseen',
      },
      { line: 3, file: 'IMG_2.jpg', expected: 'unrecognized', difficulty: 'oos', note: 'pantti' },
    ])
  })

  it('reports the real line number when the file has blank lines', () => {
    const csv = 'file,expected,difficulty\n\nIMG_1.jpg,glass,easy\n\n\nIMG_2.jpg,banana,easy\n'
    expect(problemsOf(() => parseLabels(csv, parse, exists(['IMG_1.jpg', 'IMG_2.jpg'])))).toEqual([
      'line 6: unknown category "banana"',
    ])
  })

  it('treats the note column as optional', () => {
    const labels = parseLabels(
      'file,expected,difficulty\nIMG_1.jpg,paper,hard\n',
      parse,
      exists(['IMG_1.jpg'])
    )
    expect(labels[0]).toMatchObject({ file: 'IMG_1.jpg', note: '' })
  })

  it('lists every invalid row at once, with line numbers', () => {
    const csv = [
      'file,expected,difficulty,note',
      'IMG_1.jpg,glass,easy,ok',
      'IMG_2.jpg,banana,easy,',
      'IMG_3.jpg,paper,medium,',
      'IMG_404.jpg,paper,hard,',
      'IMG_1.jpg,glass,easy,again',
      ',paper,easy,',
    ].join('\n')

    expect(
      problemsOf(() => parseLabels(csv, parse, exists(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg'])))
    ).toEqual([
      'line 3: unknown category "banana"',
      'line 4: unknown difficulty "medium" (expected easy, hard, oos)',
      'line 5: missing file "IMG_404.jpg"',
      'line 6: duplicate file "IMG_1.jpg" (also on line 2)',
      'line 7: empty file',
    ])
  })

  it('reports several problems on the same row', () => {
    expect(
      problemsOf(() =>
        parseLabels('file,expected,difficulty\nIMG_9.jpg,Glass,Easy\n', parse, exists([]))
      )
    ).toEqual([
      'line 2: missing file "IMG_9.jpg"',
      'line 2: unknown category "Glass"',
      'line 2: unknown difficulty "Easy" (expected easy, hard, oos)',
    ])
  })

  it('fails on missing columns and on an empty file', () => {
    expect(
      problemsOf(() => parseLabels('file,expected\nIMG_1.jpg,glass\n', parse, exists([])))
    ).toEqual(['missing column(s): difficulty'])
    expect(problemsOf(() => parseLabels('file,expected,difficulty\n', parse, exists([])))).toEqual([
      'no rows',
    ])
  })
})
