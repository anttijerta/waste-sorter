/// <reference lib="dom" />
import { type APIRequestContext, type Page, expect } from '@playwright/test'

/**
 * A structurally complete JPEG of exactly `size` bytes: a 16×16 frame
 * header, a scan header, scan data starting with `payload` (zero-padded)
 * and the end-of-image marker. The server only reads the segment structure
 * and the mock classifier does not decode images, so this is enough for
 * API-level tests.
 *
 * `payload` must not contain 0xFF: inside scan data that byte starts a
 * marker.
 */
export function fakeJpeg(size: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  if (payload.includes(0xff)) {
    throw new Error('fakeJpeg payload must not contain 0xFF')
  }
  const header = Buffer.from([
    // SOI
    0xff, 0xd8,
    // Baseline frame header (SOF0): 8-bit, 16×16, one component
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00,
    // Start of scan (SOS) for that component
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  ])
  const eoi = Buffer.from([0xff, 0xd9])
  const buffer = Buffer.alloc(Math.max(size, header.length + payload.length + eoi.length))
  header.copy(buffer)
  payload.copy(buffer, header.length)
  eoi.copy(buffer, buffer.length - eoi.length)
  return buffer
}

/**
 * Posts an image to /api/classify the way the browser does, including the
 * CSRF token. Loading a page first sets the session and XSRF-TOKEN cookies.
 */
export async function postImage(
  request: APIRequestContext,
  image: Buffer,
  headers: Record<string, string> = {}
) {
  await request.get('/')
  const { cookies } = await request.storageState()
  const token = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')!.value

  return request.post('/api/classify', {
    headers: { 'Accept': 'application/json', 'X-XSRF-TOKEN': token, ...headers },
    multipart: { image: { name: 'image.jpg', mimeType: 'image/jpeg', buffer: image } },
  })
}

/**
 * Draws a 1600×1200 test photo on a canvas in the browser and returns it
 * as JPEG bytes, so no binary fixture lives in the repo.
 */
export async function drawTestJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 1200
    const context = canvas.getContext('2d')!
    context.fillStyle = '#2d7d46'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#ffffff'
    context.fillRect(400, 300, 800, 600)
    const jpeg = await new Promise<Blob>((resolve) =>
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg')
    )
    const bytes = new Uint8Array(await jpeg.arrayBuffer())
    return btoa(String.fromCharCode(...bytes))
  })
  return Buffer.from(base64, 'base64')
}

/**
 * Uploads through the UI and waits until the page has handled the response.
 * Earlier results stay on screen, so waiting for them would not be enough.
 */
export async function uploadInBrowser(page: Page, image: Buffer) {
  const input = page.getByTestId('image-input')
  const response = page.waitForResponse('**/api/classify')
  await input.setInputFiles({ name: 'item.jpg', mimeType: 'image/jpeg', buffer: image })
  await response
  await expect(input).toBeEnabled()
}
