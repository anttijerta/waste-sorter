import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { drawTestJpeg, fakeJpeg, postImage, uploadInBrowser } from './helpers.js'

// The server for this project allows 2 images per IP per day and only
// trusts X-Forwarded-For from 192.0.2.1, so this client is untrusted.
const DAILY_LIMIT = 2

const randomIp = () => `198.51.100.${randomInt(1, 255)}`

test('a spoofed X-Forwarded-For from an untrusted client does not bypass the per-IP limit', async ({
  request,
}) => {
  const image = fakeJpeg(4096)

  for (let i = 0; i < DAILY_LIMIT; i++) {
    const response = await postImage(request, image, { 'X-Forwarded-For': randomIp() })
    expect(response.status()).toBe(200)
  }

  // Every request claims to come from a new IP. If the header were trusted,
  // each would get a fresh limit and succeed.
  for (let i = 0; i < 3; i++) {
    const response = await postImage(request, image, { 'X-Forwarded-For': randomIp() })
    expect(response.status()).toBe(429)
    const body = await response.json()
    expect(body.code).toBe('daily')
  }
})

test('the UI shows the Finnish daily limit message', async ({ page }) => {
  await page.goto('/')
  const image = await drawTestJpeg(page)

  // The browser may reach the server as ::1 or 127.0.0.1, so it may still
  // have quota left; upload until the limit is hit.
  const limitError = page.getByTestId('limit-error')
  for (let i = 0; i <= DAILY_LIMIT && !(await limitError.isVisible()); i++) {
    await uploadInBrowser(page, image)
  }

  await expect(limitError).toHaveAttribute('data-code', 'daily')
  await expect(limitError).toHaveText('Päivän kuvaraja on täynnä. Voit jatkaa huomenna.')
})
