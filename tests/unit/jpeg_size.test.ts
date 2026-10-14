import { describe, expect, it } from 'vitest'
import { readJpegSize } from '#classifier/jpeg_size'

const segment = (marker: number, payload: number[]) => {
  const length = payload.length + 2
  return [0xff, marker, length >> 8, length & 0xff, ...payload]
}

const app0 = segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0])
const sof = (marker: number, width: number, height: number) =>
  segment(marker, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0])
const sos = segment(0xda, [1, 1, 0, 0, 63, 0])
const jpeg = (...parts: number[][]) => Buffer.from([0xff, 0xd8, ...parts.flat()])

describe('readJpegSize', () => {
  it('reads width and height from a baseline frame header after APP0', () => {
    expect(readJpegSize(jpeg(app0, sof(0xc0, 1024, 768)))).toEqual({ width: 1024, height: 768 })
  })

  it('reads progressive frames and skips fill bytes', () => {
    expect(readJpegSize(jpeg([0xff], sof(0xc2, 640, 1024)))).toEqual({ width: 640, height: 1024 })
  })

  it('does not mistake a Huffman table (C4) for a frame', () => {
    const huffman = segment(0xc4, [0, 1, 2, 3])
    expect(readJpegSize(jpeg(huffman, sof(0xc0, 300, 200)))).toEqual({ width: 300, height: 200 })
  })

  it('rejects non-JPEG data, truncated headers and scans without a frame', () => {
    expect(readJpegSize(Buffer.from('not a jpeg'))).toBeNull()
    expect(readJpegSize(jpeg(app0).subarray(0, 8))).toBeNull()
    expect(readJpegSize(jpeg(sof(0xc0, 1024, 768)).subarray(0, 8))).toBeNull()
    expect(readJpegSize(jpeg(app0, sos))).toBeNull()
    expect(readJpegSize(jpeg(sof(0xc0, 0, 0)))).toBeNull()
  })
})
