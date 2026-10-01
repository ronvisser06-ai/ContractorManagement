import { headers } from 'next/headers'

// Absolute base URL of the current request (for links in emails / on screen).
export async function requestBaseUrl(): Promise<string> {
  const hdrs = await headers()
  const host = hdrs.get('host') ?? 'localhost:3000'
  const proto = host.startsWith('localhost') || /^\d+\.\d/.test(host) ? 'http' : 'https'
  return `${proto}://${host}`
}
