import proxyAddr from 'proxy-addr'

/**
 * Builds the trust function for X-Forwarded-For from a comma-separated
 * list of IPs or CIDRs (the reverse proxy). An empty list trusts nobody,
 * so the client address always comes from the socket and a client cannot
 * spoof its IP by sending the header itself.
 */
export function compileTrustedProxies(list: string): (address: string, hop: number) => boolean {
  const entries = list
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return proxyAddr.compile(entries)
}
