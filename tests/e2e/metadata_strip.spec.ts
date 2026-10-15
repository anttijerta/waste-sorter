import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import type Sharp from 'sharp'
import { postImage } from './helpers.js'

// sharp is CommonJS; importing it as ESM trips a Node 24.2 loader assertion
// ("Unexpected module status"), so it is loaded with require().
const sharp = createRequire(import.meta.url)('sharp') as typeof Sharp

/**
 * Segments that sharp writes for EXIF (with GPS), XMP and ICC, taken from
 * a small JPEG so they can be added to another image unchanged.
 */
async function metadataSegments(): Promise<Buffer[]> {
  const source = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
    .jpeg()
    .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '60/1 11/1 54/1' } })
    .withIccProfile('srgb')
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">GPS 60.198N 24.94E</x:xmpmeta>')
    .toBuffer()

  const segments: Buffer[] = []
  let offset = 2
  while (source[offset] === 0xff && source[offset + 1] !== 0xda) {
    const marker = source[offset + 1]
    const end = offset + 2 + source.readUInt16BE(offset + 2)
    if (marker >= 0xe1 && marker <= 0xef) segments.push(source.subarray(offset, end))
    offset = end
  }
  return segments
}

const hasGpsPointer = (data: Buffer) =>
  data.includes(Buffer.from([0x25, 0x88])) || data.includes(Buffer.from([0x88, 0x25]))

test('metadata is removed on the server before the image reaches a classifier', async ({
  request,
}) => {
  // A plain JPEG, and the same JPEG with EXIF (GPS), XMP, ICC, a comment and
  // trailing data, as a client that skips the browser step could send it.
  const clean = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 140, b: 90 } },
  })
    .jpeg()
    .toBuffer()
  const comment = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0x00, 0x0e]),
    Buffer.from('lat 60.198N!'),
  ])
  const withMetadata = Buffer.concat([
    clean.subarray(0, 2),
    ...(await metadataSegments()),
    comment,
    clean.subarray(2),
    Buffer.from('trailing GPS 60.198,24.94'),
  ])
  const { exif } = await sharp(withMetadata).metadata()
  expect(exif && hasGpsPointer(exif)).toBe(true)

  const cleanResponse = await postImage(request, clean)
  const metadataResponse = await postImage(request, withMetadata)
  expect(cleanResponse.status()).toBe(200)
  expect(metadataResponse.status()).toBe(200)

  // The mock classifiers derive the category and token usage from a hash of
  // the exact bytes they receive. Identical results for both uploads mean
  // the classifiers got identical bytes: the clean JPEG, without EXIF or GPS.
  const summary = async (response: typeof cleanResponse) => {
    const body = await response.json()
    return body.models.map((m: { modelId: string; category: string; costMicroEur: number }) => [
      m.modelId,
      m.category,
      m.costMicroEur,
    ])
  }
  expect(await summary(metadataResponse)).toEqual(await summary(cleanResponse))
})
