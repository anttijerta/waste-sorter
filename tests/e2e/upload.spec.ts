/// <reference lib="dom" />
import { expect, test } from '@playwright/test'
import { drawTestJpeg, uploadInBrowser } from './helpers.js'

test('uploading a photo shows results from both models', async ({ page }) => {
  await page.goto('/')

  // The mock classifier is active in tests, so results must be labelled as simulated.
  await expect(page.getByTestId('demo-mode')).toContainText('Demotila: mallit ovat simuloituja')
  await expect(page.getByTestId('hsy-note')).toHaveText(
    'Luokat noudattavat HSY:n lajitteluohjetta (pääkaupunkiseutu).'
  )
  // From config/eval_summary.ts
  await expect(page.getByTestId('eval-summary')).toHaveText(
    'Testattu 24 kuvalla, 3 kierrosta: gpt-6-luna noin 82 %, gpt-6.1-sol noin 97 % oikein (15.10.2026).'
  )

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

test('"Näytä mitä tapahtui" explains each step of the last image', async ({ page }) => {
  await page.goto('/')
  await uploadInBrowser(page, await drawTestJpeg(page))

  const details = page.getByTestId('what-happened')
  await expect(details).toBeVisible()
  // Collapsed until opened
  await expect(details).not.toHaveAttribute('open')
  await expect(page.getByTestId('step-prepare')).toBeHidden()
  await details.getByText('Näytä mitä tapahtui').click()

  // The test photo is 1600×1200; the browser makes it 1024×768
  const prepare = page.getByTestId('step-prepare')
  await expect(prepare).toContainText('Selain pienensi kuvan 1600×1200 px')
  await expect(prepare).toContainText('kokoon 1024×768 px')
  await expect(prepare).toContainText('Metatiedot, kuten sijainti, poistettiin')

  const sent = page.getByTestId('step-sent')
  await expect(sent).toContainText('sama kuva (1024×768 px')
  await expect(sent.locator('ul > li')).toHaveCount(2)
  await expect(sent).toContainText('enintään 800 vastaustokenia')
  await sent.getByText('Näytä ohje').click()
  await expect(page.getByTestId('prompt')).toContainText('Categories (id: Finnish name):')

  // One line per model with answer, tokens, cost and latency
  const rows = page.getByTestId('answer-row')
  await expect(rows).toHaveCount(2)
  for (const row of await rows.all()) {
    await expect(row.getByTestId('answer-tokens')).toHaveText(
      /^\d[\d\s]* syötetokenia, \d+ vastaustokenia$/
    )
    await expect(row.getByTestId('answer-cost')).toContainText('€')
    await expect(row.getByTestId('answer-latency')).toHaveText(/^\d+ ms$/)
  }

  // The comparison matches the banner above the results
  const agreed = await page.getByTestId('agreement').getAttribute('data-agreed')
  await expect(page.getByTestId('step-agreement')).toContainText(
    agreed === 'true' ? 'Mallit olivat samaa mieltä' : 'Mallit olivat eri mieltä'
  )
})
