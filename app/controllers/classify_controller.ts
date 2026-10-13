import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import ClassifyService from '#services/classify_service'

/**
 * The browser re-encodes every upload to JPEG and caps it at 1024 px,
 * so anything larger or of another type did not come from our client.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const INVALID_IMAGE = 'Kuva puuttuu tai se ei kelpaa. Lähetä JPEG-kuva, enintään 2 Mt.'

/**
 * Reads the "image" part into memory. This route is excluded from the
 * bodyparser's automatic processing (config/bodyparser.ts), which would
 * otherwise write the upload to a temp file on disk.
 *
 * Returns null when the part is missing or over the size limit.
 */
async function readImage(request: HttpContext['request']): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  let received = false

  request.multipart.onFile('image', {}, async (part, reportChunk) => {
    received = true
    for await (const chunk of part as AsyncIterable<Buffer>) {
      reportChunk(chunk)
      size += chunk.length
      if (size <= MAX_IMAGE_BYTES) {
        chunks.push(chunk)
      }
    }
  })

  try {
    // Hard cap for the whole body, so oversized uploads are cut off early.
    await request.multipart.process({ limit: MAX_IMAGE_BYTES + 64 * 1024 })
  } catch {
    return null
  }

  return received && size <= MAX_IMAGE_BYTES ? Buffer.concat(chunks) : null
}

@inject()
export default class ClassifyController {
  constructor(private classifyService: ClassifyService) {}

  /**
   * The image is only held in memory for the duration of the request.
   * It is never stored or logged.
   */
  async store({ request, response }: HttpContext) {
    const image = await readImage(request)
    if (!image || !image.subarray(0, 3).equals(JPEG_MAGIC)) {
      return response.unprocessableEntity({ error: INVALID_IMAGE })
    }

    return this.classifyService.classify(image)
  }
}
