import { createHmac } from 'node:crypto'

/**
 * UTC calendar day as YYYY-MM-DD.
 */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/**
 * UTC calendar month as YYYY-MM.
 */
export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/**
 * Pseudonymous rate-limit key for a client IP: HMAC-SHA256 keyed with the
 * app secret. The UTC date is part of the message, so the same IP hashes
 * differently every day and keys cannot be linked across days. The raw IP
 * is never stored.
 */
export function hashIp(ip: string, secret: string, now: Date): string {
  return createHmac('sha256', secret)
    .update(`${utcDay(now)}|${ip}`)
    .digest('hex')
}
