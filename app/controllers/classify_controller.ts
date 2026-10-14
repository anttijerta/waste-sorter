import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import ClassifyService, { type ClassifyResponse } from '#services/classify_service'
import UsageService from '#usage/usage_service'
import { hashIp } from '#usage/ip_hash'
import { type LimitReason } from '#usage/limits'
import { readJpegSize } from '#classifier/jpeg_size'

/**
 * The browser re-encodes every upload to JPEG and caps it at 1024 px,
 * so anything larger or of another type did not come from our client.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const MAX_IMAGE_SIDE_PX = 1024
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const INVALID_IMAGE =
  'Kuva puuttuu tai se ei kelpaa. Lähetä JPEG-kuva, enintään 2 Mt ja 1024 pikseliä.'

const LIMIT_MESSAGES: Record<LimitReason, string> = {
  per_minute: 'Liian monta kuvaa lyhyessä ajassa. Odota hetki ja yritä uudelleen.',
  daily: 'Päivän kuvaraja on täynnä. Voit jatkaa huomenna.',
  monthly_cap: 'Demo on tauolla tämän kuun loppuun: kuukauden kulukatto on täynnä.',
}

/**
 * Reads the "image" part into memory. Bodyparser auto-processing is
 * disabled (config/bodyparser.ts), so the upload never touches the disk.
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
  constructor(
    private classifyService: ClassifyService,
    private usage: UsageService
  ) {}

  /**
   * The image is only held in memory for the duration of the request.
   * It is never stored or logged.
   */
  async store({ request, response }: HttpContext) {
    const image = await readImage(request)
    if (!image || !image.subarray(0, 3).equals(JPEG_MAGIC)) {
      return response.unprocessableEntity({ error: INVALID_IMAGE })
    }
    // The browser downscales to 1024 px. Checking it here keeps the token
    // estimate (config/pricing.ts) an upper bound for any client.
    const size = readJpegSize(image)
    if (!size || size.width > MAX_IMAGE_SIDE_PX || size.height > MAX_IMAGE_SIDE_PX) {
      return response.unprocessableEntity({ error: INVALID_IMAGE })
    }

    // Reserve budget before calling the models, so concurrent requests
    // cannot exceed the limits. Invalid uploads above never count.
    const ipHash = hashIp(request.ip(), env.get('APP_KEY').release(), new Date())
    const reservation = await this.usage.reserve(ipHash, this.classifyService.reserveMicroEur)
    if (!reservation.ok) {
      if (reservation.reason === 'per_minute') {
        response.header('Retry-After', '60')
      }
      return response.tooManyRequests({
        error: LIMIT_MESSAGES[reservation.reason],
        code: reservation.reason,
      })
    }

    let result: ClassifyResponse | undefined
    try {
      result = await this.classifyService.classify(image)
      return result
    } finally {
      await this.usage.settle(reservation.id, this.classifyService.settledCostMicroEur(result))
    }
  }
}
