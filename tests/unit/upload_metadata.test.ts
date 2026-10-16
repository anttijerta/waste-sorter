// Loaded first, like bin/server.ts does: the controller's @inject() needs it.
import 'reflect-metadata'
import { type Server, createServer } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type OpenAI from 'openai'
import { type Database } from '@adonisjs/lucid/database'
import BodyParserMiddleware from '@adonisjs/core/bodyparser_middleware'
import { HttpContextFactory, RequestFactory, ResponseFactory } from '@adonisjs/core/factories/http'
import bodyParserConfig from '#config/bodyparser'
import ClassifyController from '#controllers/classify_controller'
import ClassifyService from '#services/classify_service'
import UsageService from '#usage/usage_service'
import { OpenAIClassifier } from '#classifier/openai_classifier'
import { createDatabase } from './test_database.js'

// The logger service needs a booted Adonis app; logging is not under test here.
vi.mock('@adonisjs/core/services/logger', async () => {
  const { Logger } = await import('@adonisjs/core/logger')
  return { default: new Logger({ enabled: false }) }
})

const DATA_URL_PREFIX = 'data:image/jpeg;base64,'
const TRAILING = 'MotionPhoto_Data GPS 60.19,24.94'

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

/**
 * A photo with everything a phone might add: EXIF with GPS, XMP, ICC, a
 * comment and data after the end of the image.
 */
async function photoWithMetadata(): Promise<Buffer> {
  const jpeg = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 140, b: 90 } },
  })
    .jpeg()
    .withExifMerge({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '60/1 11/1 54/1' } })
    .withIccProfile('srgb')
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:exif="http://ns.adobe.com/exif/1.0/"><rdf:Description exif:GPSLatitude="60,11.9N"/></rdf:RDF></x:xmpmeta>'
    )
    .toBuffer()
  const comment = Buffer.from('shot at Mannerheimintie 1')
  const com = Buffer.concat([
    Buffer.from([0xff, 0xfe, (comment.length + 2) >> 8, (comment.length + 2) & 0xff]),
    comment,
  ])
  return Buffer.concat([jpeg.subarray(0, 2), com, jpeg.subarray(2), Buffer.from(TRAILING)])
}

/** A completed Responses API result, as the real API returns it. */
const apiResponse = {
  status: 'completed',
  incomplete_details: null,
  output: [
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '{"category":"glass"}', annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 1100,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 10 },
    total_tokens: 1120,
  },
}

type CreateBody = {
  store: boolean
  input: { content: { type: string; image_url?: string }[] }[]
}

describe('upload path', () => {
  let db: Database
  let server: Server
  let url: string
  const create = vi.fn(async (_body: CreateBody, _options: unknown) => apiResponse)

  beforeEach(async () => {
    create.mockClear()
    db = await createDatabase()

    // The app's classifiers and controller; only the OpenAI client is a spy.
    const client = { responses: { create } } as unknown as Pick<OpenAI, 'responses'>
    const classifier = (modelId: string) =>
      new OpenAIClassifier(modelId, { client, reasoningEffort: 'low', timeoutMs: 20_000 })
    const controller = new ClassifyController(
      new ClassifyService([classifier('gpt-6-luna'), classifier('gpt-6.1-sol')]),
      new UsageService(db, { perIpPerMinute: 100, perIpDaily: 100, monthlyCapMicroEur: 10 ** 9 })
    )
    const bodyParser = new BodyParserMiddleware(bodyParserConfig)

    // A real HTTP request through the app's bodyparser config, on loopback.
    server = createServer(async (req, res) => {
      const request = new RequestFactory().merge({ req, res }).create()
      const response = new ResponseFactory().merge({ req, res }).create()
      const ctx = new HttpContextFactory().merge({ request, response }).create()
      const body = await bodyParser.handle(ctx, () => controller.store(ctx))
      if (body !== undefined) response.send(body)
      response.finish()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/classify`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    await db.manager.closeAll()
  })

  it('image reaching the OpenAI API contains no metadata', async () => {
    const upload = await photoWithMetadata()
    const before = await sharp(upload).metadata()
    expect(hasGpsPointer(before.exif!)).toBe(true)
    expect(before.xmp).toBeDefined()
    expect(before.icc).toBeDefined()
    expect(upload.includes(Buffer.from('GPSLatitude'))).toBe(true)
    expect(segmentMarkers(upload)).toContain(0xfe)

    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(upload)], { type: 'image/jpeg' }), 'image.jpg')
    const response = await fetch(url, { method: 'POST', body: form })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.image.metadataBytesRemoved).toBeGreaterThan(0)

    // One call per model, the same bytes to both, never stored at OpenAI
    expect(create).toHaveBeenCalledTimes(2)
    const sent = create.mock.calls.map(([request]) => {
      expect(request.store).toBe(false)
      const imageUrl = request.input[0].content.find(
        (part) => part.type === 'input_image'
      )!.image_url!
      expect(imageUrl.startsWith(DATA_URL_PREFIX)).toBe(true)
      return Buffer.from(imageUrl.slice(DATA_URL_PREFIX.length), 'base64')
    })
    expect(sent[0].equals(sent[1])).toBe(true)

    for (const image of sent) {
      expect(image.includes(Buffer.from('Exif\0'))).toBe(false)
      expect(image.includes(Buffer.from('adobe:ns:meta'))).toBe(false)
      expect(image.includes(Buffer.from('http://ns.adobe.com/'))).toBe(false)
      expect(image.includes(Buffer.from('GPSLatitude'))).toBe(false)
      expect(image.includes(Buffer.from('Mannerheimintie'))).toBe(false)
      expect(image.includes(Buffer.from(TRAILING))).toBe(false)
      // APP1–APP15 except APP14 (Adobe), and COM
      const metadataMarkers = segmentMarkers(image).filter(
        (m) => (m >= 0xe1 && m <= 0xef && m !== 0xee) || m === 0xfe
      )
      expect(metadataMarkers).toEqual([])
      expect(image.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]))

      // Still a real, decodable photo
      const after = await sharp(image).metadata()
      expect([after.width, after.height]).toEqual([64, 48])
      expect(after.exif).toBeUndefined()
      expect(after.xmp).toBeUndefined()
      expect(after.icc).toBeUndefined()
    }
  })
})
