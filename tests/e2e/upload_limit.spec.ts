import { expect, test } from '@playwright/test'
import { fakeJpeg, postImage } from './helpers.js'

const LIMIT_BYTES = 2 * 1024 * 1024

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
