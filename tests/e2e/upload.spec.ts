/// <reference lib="dom" />
import { expect, test } from '@playwright/test'

test('uploading a photo shows results from both models', async ({ page }) => {
  await page.goto('/')

  // Draw a test image in the browser so no binary fixture lives in the repo.
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

  const upload = () =>
    page.getByTestId('image-input').setInputFiles({
      name: 'item.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(base64, 'base64'),
    })
  const results = page.getByTestId('results')
  const usdValues = (rowTestId: string) =>
    results
      .getByTestId(rowTestId)
      .locator('td')
      .evaluateAll((cells) => cells.map((cell) => Number(cell.getAttribute('data-usd'))))

  await upload()

  // One column per model: every figure, costs included, belongs to one model.
  await expect(results.locator('thead th')).toHaveCount(3)
  for (const row of ['category', 'latency', 'cost-image', 'cost-session', 'cost-1000']) {
    await expect(results.getByTestId(row).locator('td')).toHaveCount(2)
  }
  await expect(results.getByTestId('cost-image').locator('td').first()).toContainText('$')
  await expect(page.getByTestId('costs')).toHaveCount(0)
  await expect(page.getByTestId('agreement')).toBeVisible()

  const perImage = await usdValues('cost-image')
  expect(await usdValues('cost-1000')).toEqual(perImage.map((cost) => cost * 1000))
  expect(await usdValues('cost-session')).toEqual(perImage)

  // The mock is deterministic, so the same image costs the same again and
  // each model's session total doubles independently.
  await upload()
  await expect.poll(() => usdValues('cost-session')).toEqual(perImage.map((cost) => cost * 2))

  // The preview shows the same blob that was uploaded: it must be downscaled.
  const width = await page
    .getByAltText('Lähetetty kuva')
    .evaluate((img: HTMLImageElement) => img.naturalWidth)
  expect(width).toBe(1024)
})
