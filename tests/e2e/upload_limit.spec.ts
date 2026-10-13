import { type APIRequestContext, expect, test } from '@playwright/test'

const LIMIT_BYTES = 2 * 1024 * 1024

/**
 * A buffer that starts with the JPEG magic bytes, so only the size rule
 * decides whether it is accepted.
 */
function fakeJpeg(size: number): Buffer {
  const buffer = Buffer.alloc(size)
  buffer.set([0xff, 0xd8, 0xff, 0xe0])
  return buffer
}

async function postImage(request: APIRequestContext, image: Buffer) {
  // Loading a page sets the session and XSRF-TOKEN cookies that CSRF needs.
  await request.get('/')
  const { cookies } = await request.storageState()
  const token = cookies.find((cookie) => cookie.name === 'XSRF-TOKEN')!.value

  return request.post('/api/classify', {
    headers: { 'Accept': 'application/json', 'X-XSRF-TOKEN': token },
    multipart: { image: { name: 'image.jpg', mimeType: 'image/jpeg', buffer: image } },
  })
}

test('accepts an image just under the 2 MB limit', async ({ request }) => {
  const response = await postImage(request, fakeJpeg(LIMIT_BYTES - 1024))
  expect(response.status()).toBe(200)
})

test('rejects an image over the 2 MB limit', async ({ request }) => {
  const response = await postImage(request, fakeJpeg(LIMIT_BYTES + 1024))
  expect(response.status()).toBe(422)
  const body = await response.json()
  expect(body.error).toContain('2 Mt')
})

test('rejects an image far over the limit without reading it all', async ({ request }) => {
  const response = await postImage(request, fakeJpeg(LIMIT_BYTES * 5))
  expect(response.status()).toBe(422)
})
