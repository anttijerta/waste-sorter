import { randomBytes } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { postImage } from './helpers.js'

/**
 * Returns the files in `dir` modified at or after `since` whose contents
 * include `marker`. The test server runs on this machine, so it shares
 * the same tmp directory.
 */
async function filesContaining(dir: string, marker: Buffer, since: number): Promise<string[]> {
  const matches: string[] = []
  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    try {
      const info = await stat(path)
      if (!info.isFile() || info.mtimeMs < since || info.size > 10 * 1024 * 1024) continue
      const contents = await readFile(path)
      if (contents.includes(marker)) matches.push(path)
    } catch {
      // Files may disappear or be unreadable; they cannot be our upload.
    }
  }
  return matches
}

test('an uploaded image is never written to the tmp directory', async ({ request }) => {
  const marker = randomBytes(32)
  const image = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), marker, Buffer.alloc(4096)])
  const since = Date.now() - 1000

  const response = await postImage(request, image)
  expect(await filesContaining(tmpdir(), marker, since)).toEqual([])
  expect(response.status()).toBe(200)
})
