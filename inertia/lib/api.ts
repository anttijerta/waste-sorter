import type { ClassifyResponse } from '../../app/services/classify_service'

export type { ClassifyResponse }

/**
 * Shield stores the CSRF token in the XSRF-TOKEN cookie and decodes the
 * header value itself, so the cookie value is sent as is.
 */
function xsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)
  return match ? match[1] : null
}

export class ClassifyError extends Error {}

export async function classifyImage(image: Blob): Promise<ClassifyResponse> {
  const body = new FormData()
  body.append('image', image, 'image.jpg')

  const token = xsrfToken()
  const response = await fetch('/api/classify', {
    method: 'POST',
    body,
    headers: { Accept: 'application/json', ...(token ? { 'X-XSRF-TOKEN': token } : {}) },
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new ClassifyError(payload?.error ?? 'Luokittelu epäonnistui. Yritä uudelleen.')
  }
  return response.json()
}
