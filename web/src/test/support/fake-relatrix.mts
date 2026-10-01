// A fake Relatrix over real HTTP, for the sync tests. It behaves like the parts of the real API the integration
// uses (/api/v1/pipelines, /api/v1/companies): bearer auth, external_ref filtering, source and tags (tags tidied the
// way Relatrix's database does), Idempotency-Key replays, and a 409 for a duplicate name. A test steers it with
// `script` to make it fail the way the real one can.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeCompany {
  id: string
  name: string
  domain: string | null
  source: string | null
  tags: string[]
  external_refs: Record<string, string>
}

export interface RecordedRequest {
  method: string
  url: string
  authorization: string | undefined
  idempotencyKey: string | undefined
  body: unknown
}

export interface FakeRelatrix {
  url: string
  key: string
  companies: Map<string, FakeCompany>
  requests: RecordedRequest[]
  /** Answer the next requests with these statuses first (0 = drop the connection, -1 = never answer). */
  script: number[]
  setFail(statuses: number[]): void
  reset(): void
  close(): Promise<void>
}

const KEY = `rlx_${'a'.repeat(64)}`

const tidy = (tags: string[]) => Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))).sort()

async function readBody(req: IncomingMessage): Promise<string> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text
}

export async function startFakeRelatrix(): Promise<FakeRelatrix> {
  const companies = new Map<string, FakeCompany>()
  const replays = new Map<string, { status: number; body: unknown; hash: string }>()
  const requests: RecordedRequest[] = []
  let n = 0
  const state = { script: [] as number[] }

  const server: Server = createServer(async (req, res) => {
    const raw = await readBody(req)
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined
    const url = new URL(req.url ?? '/', 'http://x')
    const idem = req.headers['idempotency-key'] as string | undefined
    requests.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, idempotencyKey: idem, body })

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(payload))
    }

    const scripted = state.script.shift()
    if (scripted === 0) return req.socket.destroy()
    if (scripted === -1) return // never answers
    if (scripted) return send(scripted, { error: { code: 'scripted', message: `Scripted ${scripted}.` } }, scripted === 429 ? { 'retry-after': '120' } : {})

    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { code: 'unauthorized', message: 'Not a valid key.' } })

    if (url.pathname === '/api/v1/pipelines') return send(200, { data: [], next_cursor: null })

    if (url.pathname === '/api/v1/companies' && req.method === 'GET') {
      const refs = [...url.searchParams].filter(([k]) => k.startsWith('external_ref['))
      const found = [...companies.values()].filter((c) => refs.every(([k, v]) => c.external_refs[k.slice(13, -1)] === v))
      return send(200, { data: found, next_cursor: null })
    }

    if (url.pathname === '/api/v1/companies' && req.method === 'POST') {
      const hash = JSON.stringify(body)
      if (idem) {
        const seen = replays.get(idem)
        if (seen) return seen.hash === hash ? send(seen.status, seen.body, { 'idempotent-replay': 'true' }) : send(422, { error: { code: 'idempotency_key_reuse', message: 'That key was used for a different request.' } })
      }
      const name = String(body?.name ?? '')
      if (!name) return send(422, { error: { code: 'invalid_request', message: '“name” is required.' } })
      if ([...companies.values()].some((c) => c.name.toLowerCase() === name.toLowerCase())) return send(409, { error: { code: 'conflict', message: 'That conflicts with a record that already exists.' } })
      n += 1
      const created: FakeCompany = {
        id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        name,
        domain: (body?.domain as string | undefined) ?? null,
        source: (body?.source as string | null | undefined) ?? null,
        tags: tidy((body?.tags as string[] | undefined) ?? []),
        external_refs: (body?.external_refs as Record<string, string> | undefined) ?? {},
      }
      companies.set(created.id, created)
      const reply = { data: created }
      if (idem) replays.set(idem, { status: 201, body: reply, hash })
      return send(201, reply)
    }

    const one = /^\/api\/v1\/companies\/([^/]+)$/.exec(url.pathname)
    if (one && req.method === 'PATCH') {
      const company = companies.get(one[1]!)
      if (!company) return send(404, { error: { code: 'not_found', message: 'No such company.' } })
      if (body && 'name' in body) company.name = String(body.name)
      if (body && 'source' in body) company.source = (body.source as string | null) ?? null
      if (body && 'tags' in body) company.tags = tidy(body.tags as string[])
      return send(200, { data: company })
    }
    return send(404, { error: { code: 'not_found', message: 'No such route.' } })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    key: KEY,
    companies,
    requests,
    get script() {
      return state.script
    },
    set script(v: number[]) {
      state.script = v
    },
    setFail(statuses) {
      state.script = [...statuses]
    },
    reset() {
      companies.clear()
      replays.clear()
      requests.length = 0
      state.script = []
      n = 0
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
