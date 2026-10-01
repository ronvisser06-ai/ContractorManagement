import { createRelatrixClient, RelatrixError } from '@/lib/relatrix/client'
import { readConfig } from '@/lib/relatrix/config'

// Is the Relatrix connection set up, and does the key work? Says nothing about the key or the address. A dry run or a
// run that is off reports `configured` without calling Relatrix.
export async function GET() {
  const configured = readConfig(process.env)
  if (!configured.ok) return Response.json({ mode: configured.mode, configured: false, reason: configured.reason })
  const { config } = configured
  if (config.mode !== 'live') return Response.json({ mode: config.mode, configured: true, reachable: null })

  try {
    await createRelatrixClient({ baseUrl: config.baseUrl, apiKey: config.apiKey, timeoutMs: 8000 }).health()
    return Response.json({ mode: 'live', configured: true, reachable: true })
  } catch (e) {
    const err = e instanceof RelatrixError ? e : null
    return Response.json({ mode: 'live', configured: true, reachable: false, kind: err?.kind ?? 'transient', status: err?.status ?? null }, { status: 503 })
  }
}
