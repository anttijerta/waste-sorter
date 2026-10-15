import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { readJpegSize } from '#classifier/jpeg_size'
import { stripJpegMetadata } from '#classifier/jpeg_strip'

/** EXIF links GPS data through tag 0x8825 (GPS IFD pointer), in either byte order. */
const hasGpsPointer = (data: Buffer) =>
  data.includes(Buffer.from([0x25, 0x88])) || data.includes(Buffer.from([0x88, 0x25]))

/** Marker codes of all segments before the first scan. */
function segmentMarkers(data: Buffer): number[] {
  const markers: number[] = []
  let offset = 2
  while (offset + 4 <= data.length && data[offset] === 0xff) {
    const marker = data[offset + 1]
    markers.push(marker)
    if (marker === 0xda) break
    offset += 2 + data.readUInt16BE(offset + 2)
  }
  return markers
}

function withComment(jpeg: Buffer, text: string): Buffer {
  const body = Buffer.from(text)
  const segment = Buffer.concat([
    Buffer.from([0xff, 0xfe, (body.length + 2) >> 8, (body.length + 2) & 0xff]),
    body,
  ])
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
}

/** A photo with everything a phone might add: EXIF with GPS, XMP, ICC. */
async function photoWithMetadata(options: { progressive?: boolean } = {}): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg({ progressive: options.progressive ?? false })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '60/1 11/1 54/1' } })
    .withIccProfile('srgb')
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:exif="http://ns.adobe.com/exif/1.0/"><rdf:Description exif:GPSLatitude="60,11.9N"/></rdf:RDF></x:xmpmeta>'
    )
    .toBuffer()
}

describe('stripJpegMetadata', () => {
  it('removes EXIF with GPS, XMP, ICC profiles and comments', async () => {
    const input = withComment(await photoWithMetadata(), 'shot at Mannerheimintie 1')
    const before = await sharp(input).metadata()
    expect(before.exif).toBeDefined()
    expect(before.xmp).toBeDefined()
    expect(before.icc).toBeDefined()
    expect(hasGpsPointer(before.exif!)).toBe(true)

    const output = stripJpegMetadata(input)!

    const after = await sharp(output).metadata()
    expect(after.exif).toBeUndefined()
    expect(after.xmp).toBeUndefined()
    expect(after.icc).toBeUndefined()
    expect(output.includes(Buffer.from('Exif\0'))).toBe(false)
    expect(output.includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect(output.includes(Buffer.from('Mannerheimintie'))).toBe(false)
    // Only image segments are left (APP0 JFIF may stay)
    expect(segmentMarkers(output).filter((m) => m >= 0xe1 && m <= 0xef)).toEqual([])
    expect(segmentMarkers(output)).not.toContain(0xfe)
  })

  it('keeps the image data byte for byte, without re-encoding', async () => {
    const input = await photoWithMetadata()
    const output = stripJpegMetadata(input)!

    const pixels = async (data: Buffer) => sharp(data).raw().toBuffer()
    const [outputPixels, inputPixels] = await Promise.all([pixels(output), pixels(input)])
    expect(outputPixels.equals(inputPixels)).toBe(true)
    expect(readJpegSize(output)).toEqual(readJpegSize(input))
    // The scan data at the end is copied unchanged
    expect(input.subarray(-200).equals(output.subarray(-200))).toBe(true)
  })

  it('also checks between the scans of a progressive JPEG', async () => {
    const progressive = await photoWithMetadata({ progressive: true })
    // Hide a comment between two scans: after the first scan's data
    const secondScan = progressive.indexOf(
      Buffer.from([0xff, 0xda]),
      progressive.indexOf(Buffer.from([0xff, 0xda])) + 2
    )
    expect(secondScan).toBeGreaterThan(0)
    const hidden = Buffer.from([0xff, 0xfe, 0x00, 0x0c, ...Buffer.from('lat 60.19N')])
    const input = Buffer.concat([
      progressive.subarray(0, secondScan),
      hidden,
      progressive.subarray(secondScan),
    ])

    const output = stripJpegMetadata(input)!
    expect(output.includes(Buffer.from('lat 60.19N'))).toBe(false)
    const decoded = await sharp(output).raw().toBuffer()
    expect(decoded.length).toBe(64 * 48 * 3)
  })

  it('drops data appended after the end of the image', async () => {
    const clean = stripJpegMetadata(await photoWithMetadata())!
    const input = Buffer.concat([clean, Buffer.from('MotionPhoto_Data GPS 60.19,24.94')])
    const output = stripJpegMetadata(input)!
    expect(output.equals(clean)).toBe(true)
    expect(output.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))
  })

  it('keeps stuffed bytes and restart markers inside the scan', () => {
    const scan = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd1, 0x78]
    const input = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe1,
      0x00,
      0x08,
      ...Buffer.from('Exif\0\0'),
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x10,
      0x00,
      0x10,
      0x01,
      0x01,
      0x11,
      0x00,
      0xff,
      0xda,
      0x00,
      0x08,
      0x01,
      0x01,
      0x00,
      0x00,
      0x3f,
      0x00,
      ...scan,
      0xff,
      0xd9,
    ])
    const output = stripJpegMetadata(input)!
    expect(output.includes(Buffer.from('Exif'))).toBe(false)
    expect(output.includes(Buffer.from(scan))).toBe(true)
    expect(output.length).toBe(input.length - 10)
  })

  it('rejects data that is not a complete JPEG', async () => {
    const jpeg = await photoWithMetadata()
    expect(stripJpegMetadata(Buffer.from('not a jpeg'))).toBeNull()
    expect(stripJpegMetadata(jpeg.subarray(0, jpeg.length - 2))).toBeNull()
    expect(stripJpegMetadata(jpeg.subarray(0, 40))).toBeNull()
    expect(stripJpegMetadata(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]))).toBeNull()
  })
})
