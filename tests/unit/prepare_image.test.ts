import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { readJpegSize } from '#classifier/jpeg_size'
import { EVAL_JPEG_QUALITY, EVAL_MAX_SIDE_PX, prepareImage } from '#eval/prepare_image'

/** A 2000×1500 photo stored sideways (EXIF orientation 6) with GPS data. */
async function sidewaysPhotoWithGps(): Promise<Buffer> {
  return sharp({
    create: { width: 2000, height: 1500, channels: 3, background: { r: 40, g: 120, b: 60 } },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '60/1 11/1 54/1' } })
    .toBuffer()
}

/** EXIF links GPS data through tag 0x8825 (GPS IFD pointer), in either byte order. */
function hasGpsBlock(exif: Buffer | undefined): boolean {
  return (
    !!exif && (exif.includes(Buffer.from([0x25, 0x88])) || exif.includes(Buffer.from([0x88, 0x25])))
  )
}

describe('prepareImage', () => {
  it('uses the same size and quality as the browser upload', async () => {
    // The frontend is a separate TypeScript project, so it is loaded at run
    // time instead of through a typed import.
    const browserModule: string = '../../inertia/lib/downscale.js'
    const browser = await import(browserModule)
    expect(EVAL_MAX_SIDE_PX).toBe(browser.MAX_SIDE_PX)
    expect(EVAL_JPEG_QUALITY).toBe(browser.JPEG_QUALITY)
  })

  it('turns the photo upright, fits it within 1024 px and strips all metadata', async () => {
    const input = await sidewaysPhotoWithGps()
    const before = await sharp(input).metadata()
    expect(before.orientation).toBe(6)
    expect(hasGpsBlock(before.exif)).toBe(true)

    const output = await prepareImage(sharp, input, { maxBytes: 2 * 1024 * 1024 })

    const after = await sharp(output).metadata()
    expect(after.format).toBe('jpeg')
    // Sideways 2000×1500 is upright 1500×2000, scaled to fit 1024
    expect([after.width, after.height]).toEqual([768, 1024])
    expect(readJpegSize(output)).toEqual({ width: 768, height: 1024 })
    // No EXIF at all, so no GPS and no orientation flag
    expect(after.exif).toBeUndefined()
    expect(hasGpsBlock(after.exif)).toBe(false)
    expect(after.orientation).toBeUndefined()
  })

  it('never enlarges a small image', async () => {
    const small = await sharp({
      create: { width: 300, height: 200, channels: 3, background: '#fff' },
    })
      .jpeg()
      .toBuffer()
    const output = await prepareImage(sharp, small, { maxBytes: 2 * 1024 * 1024 })
    expect(readJpegSize(output)).toEqual({ width: 300, height: 200 })
  })

  it('applies the server size limit', async () => {
    const input = await sidewaysPhotoWithGps()
    await expect(prepareImage(sharp, input, { maxBytes: 100 })).rejects.toThrow(/server limit/)
  })
})
