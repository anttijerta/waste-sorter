export const MAX_SIDE_PX = 1024
export const JPEG_QUALITY = 0.85

export type ImageSize = { width: number; height: number; bytes: number }

export type PreparedUpload = {
  jpeg: Blob
  original: ImageSize
  prepared: ImageSize
}

/**
 * Scales the image so its longest side is at most MAX_SIDE_PX and
 * re-encodes it as JPEG. Drawing to a canvas drops all metadata,
 * including EXIF (location, camera details). Returns the sizes before and
 * after, for the "what happened" view.
 */
export async function downscaleToJpeg(file: Blob): Promise<PreparedUpload> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D context is not available')
  }
  context.drawImage(bitmap, 0, 0, width, height)
  const original = { width: bitmap.width, height: bitmap.height, bytes: file.size }
  bitmap.close()

  const jpeg = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encoding failed'))),
      'image/jpeg',
      JPEG_QUALITY
    )
  })
  return { jpeg, original, prepared: { width, height, bytes: jpeg.size } }
}
