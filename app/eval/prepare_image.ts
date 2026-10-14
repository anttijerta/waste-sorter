import type Sharp from 'sharp'
import { readJpegSize } from '#classifier/jpeg_size'

/**
 * Same as the browser step in inertia/lib/downscale.ts (a test keeps the
 * numbers in sync): longest side at most 1024 px, JPEG quality 0.85.
 */
export const EVAL_MAX_SIDE_PX = 1024
export const EVAL_JPEG_QUALITY = 0.85

export type SharpFactory = typeof Sharp

/**
 * Prepares an eval photo the way the app's browser does before upload:
 * applies the EXIF orientation, fits it within 1024 px and re-encodes it
 * as JPEG without any metadata (no EXIF, no GPS). Then applies the same
 * size checks as the server.
 *
 * sharp is passed in because the command imports it dynamically; it is a
 * devDependency and not part of the production image.
 */
export async function prepareImage(
  sharp: SharpFactory,
  input: Buffer,
  limits: { maxBytes: number }
): Promise<Buffer> {
  // sharp drops all metadata unless withMetadata() is called.
  const output = await sharp(input)
    .rotate()
    .resize({
      width: EVAL_MAX_SIDE_PX,
      height: EVAL_MAX_SIDE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: Math.round(EVAL_JPEG_QUALITY * 100) })
    .toBuffer()

  const size = readJpegSize(output)
  if (!size || size.width > EVAL_MAX_SIDE_PX || size.height > EVAL_MAX_SIDE_PX) {
    throw new Error('Prepared image is not a JPEG within 1024 px')
  }
  if (output.length > limits.maxBytes) {
    throw new Error(`Prepared image is ${output.length} bytes, over the server limit`)
  }
  return output
}
