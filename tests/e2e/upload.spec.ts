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

  await page.getByTestId('image-input').setInputFiles({
    name: 'item.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(base64, 'base64'),
  })

  const rows = page.getByTestId('results').locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('agreement')).toBeVisible()
  await expect(page.getByTestId('session-total')).toContainText('$')

  // The preview shows the same blob that was uploaded: it must be downscaled.
  const width = await page
    .getByAltText('Lähetetty kuva')
    .evaluate((img: HTMLImageElement) => img.naturalWidth)
  expect(width).toBe(1024)
})
