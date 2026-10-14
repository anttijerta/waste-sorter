/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { drawTestJpeg, uploadInBrowser } from './helpers.js'

test('uploading a photo shows results from both models', async ({ page }) => {
  await page.goto('/')

  // The mock classifier is active in tests, so results must be labelled as simulated.
  await expect(page.getByTestId('demo-mode')).toContainText('Demotila: mallit ovat simuloituja')

  const image = await drawTestJpeg(page)

  const upload = () => uploadInBrowser(page, image)
  const results = page.getByTestId('results')
  const microEurValues = (rowTestId: string) =>
    results
      .getByTestId(rowTestId)
      .locator('td')
      .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute('data-micro-eur'))))

  await upload()

  // One column per model: every figure, costs included, belongs to one model.
  await expect(results.locator('thead th')).toHaveCount(3)
  for (const row of ['category', 'latency', 'cost-image', 'cost-session', 'cost-1000']) {
    await expect(results.getByTestId(row).locator('td')).toHaveCount(2)
  }
  await expect(results.getByTestId('cost-image').locator('td').first()).toContainText('€')
  await expect(page.getByTestId('costs')).toHaveCount(0)
  await expect(page.getByTestId('agreement')).toBeVisible()
  await expect(page.getByTestId('demo-mode')).toBeVisible()

  const perImage = await microEurValues('cost-image')
  expect(await microEurValues('cost-1000')).toEqual(perImage.map((cost) => cost * 1000))
  expect(await microEurValues('cost-session')).toEqual(perImage)

  // The mock is deterministic, so the same image costs the same again and
  // each model's session total doubles independently.
  await upload()
  await expect.poll(() => microEurValues('cost-session')).toEqual(perImage.map((cost) => cost * 2))

  // The preview shows the same blob that was uploaded: it must be downscaled.
  const width = await page
    .getByAltText('Lähetetty kuva')
    .evaluate((img: HTMLImageElement) => img.naturalWidth)
  expect(width).toBe(1024)
})
