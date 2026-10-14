import { expect, test } from '@playwright/test'
import { drawTestJpeg, fakeJpeg, postImage, uploadInBrowser } from './helpers.js'

// The server for this project has a monthly cap of 0.0095 EUR. Each request
// reserves an estimated 0.003125 EUR, so at most 3 reservations fit at once.
const CAP_EUR = 0.0095
const USD_TO_EUR = 1

type ResponseBody = { code?: string; models: { costUsd: number }[] }

test('a burst of requests stays within the monthly cap end to end', async ({ playwright }) => {
  const image = fakeJpeg(4096)

  // Separate request contexts, so the requests do not share a connection
  // and really arrive at the same time.
  const contexts = await Promise.all(
    Array.from({ length: 10 }, () =>
      playwright.request.newContext({ baseURL: 'http://localhost:3337' })
    )
  )
  const responses = await Promise.all(contexts.map((context) => postImage(context, image)))
  const bodies: ResponseBody[] = await Promise.all(responses.map((response) => response.json()))

  const succeeded = bodies.filter((_, i) => responses[i].status() === 200)
  const refused = bodies.filter((_, i) => responses[i].status() === 429)

  expect(succeeded.length + refused.length).toBe(10)
  expect(succeeded.length).toBeGreaterThanOrEqual(3)
  expect(refused.length).toBeGreaterThan(0)
  for (const body of refused) {
    expect(body.code).toBe('monthly_cap')
  }

  // The deterministic proof that concurrent reservations are atomic is in
  // tests/unit/usage_service.test.ts; this checks the HTTP path end to end.
  const spentEur = succeeded
    .flatMap((body) => body.models)
    .reduce((sum, model) => sum + model.costUsd * USD_TO_EUR, 0)
  expect(spentEur).toBeLessThanOrEqual(CAP_EUR)

  await Promise.all(contexts.map((context) => context.dispose()))
})

test('the UI shows that the demo is paused for the month', async ({ page }) => {
  await page.goto('/')
  const image = await drawTestJpeg(page)

  const limitError = page.getByTestId('limit-error')
  for (let i = 0; i < 10 && !(await limitError.isVisible()); i++) {
    await uploadInBrowser(page, image)
  }

  await expect(limitError).toHaveAttribute('data-code', 'monthly_cap')
  await expect(limitError).toHaveText(
    'Demo on tauolla tämän kuun loppuun: kuukauden kulukatto on täynnä.'
  )
})
