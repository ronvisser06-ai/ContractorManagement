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

export interface FakeStage {
  id: string
  name: string
  position: number
}

export interface FakePipeline {
  id: string
  name: string
  stages: FakeStage[]
}

export interface FakeDeal {
  id: string
  pipeline_id: string
  stage_id: string
  company_id: string | null
  title: string
  currency: string
  closed_at: string | null
  external_refs: Record<string, string>
}

export interface FakeActivity {
  id: string
  kind: string
  subject: string | null
  body: string | null
  occurred_at: string | null
  company_id: string | null
  deal_id: string | null
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
  pipelines: FakePipeline[]
  deals: Map<string, FakeDeal>
  activities: FakeActivity[]
  /** Every stage move Relatrix was asked for, in order. */
  moves: { deal: string; stage: string }[]
  /** Makes the pipeline Ron sets up: "ConTrak customers" with its four stages (pass fewer to leave one out). */
  addCustomerPipeline(stageNames?: string[]): FakePipeline
  requests: RecordedRequest[]
  /** Answer the next requests with these statuses first (0 = drop the connection, -1 = never answer, -2 = let this one through). */
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
  const pipelines: FakePipeline[] = []
  const deals = new Map<string, FakeDeal>()
  const activities: FakeActivity[] = []
  const moves: { deal: string; stage: string }[] = []
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
    // -2 lets this request through untouched, so a test can fail the Nth request of a sequence.
    if (scripted && scripted !== -2) return send(scripted, { error: { code: 'scripted', message: `Scripted ${scripted}.` } }, scripted === 429 ? { 'retry-after': '120' } : {})

    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { code: 'unauthorized', message: 'Not a valid key.' } })

    if (url.pathname === '/api/v1/pipelines') return send(200, { data: pipelines, next_cursor: null })

    // Idempotency for any POST: the same key and body replays the first answer; the same key on a different body is refused.
    const replayable = (make: () => { status: number; body: unknown }) => {
      const hash = req.method + url.pathname + JSON.stringify(body)
      if (idem) {
        const seen = replays.get(idem)
        if (seen) return seen.hash === hash ? send(seen.status, seen.body, { 'idempotent-replay': 'true' }) : send(422, { error: { code: 'idempotency_key_reuse', message: 'That key was used for a different request.' } })
      }
      const made = make()
      if (idem && made.status < 300) replays.set(idem, { ...made, hash })
      return send(made.status, made.body)
    }

    if (url.pathname === '/api/v1/deals' && req.method === 'GET') {
      const refs = [...url.searchParams].filter(([k]) => k.startsWith('external_ref['))
      return send(200, { data: [...deals.values()].filter((d) => refs.every(([k, v]) => d.external_refs[k.slice(13, -1)] === v)), next_cursor: null })
    }
    if (url.pathname === '/api/v1/deals' && req.method === 'POST') {
      return replayable(() => {
        const pipeline = pipelines.find((p) => p.id === body?.pipeline_id)
        if (!pipeline || !pipeline.stages.some((st) => st.id === body?.stage_id)) return { status: 422, body: { error: { code: 'invalid_request', message: 'That stage is not in that pipeline.' } } }
        if (!/^[A-Za-z]{3}$/.test(String(body?.currency ?? ''))) return { status: 422, body: { error: { code: 'invalid_request', message: '“currency” is a three-letter ISO 4217 code.' } } }
        n += 1
        const d: FakeDeal = {
          id: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
          pipeline_id: String(body?.pipeline_id), stage_id: String(body?.stage_id), company_id: (body?.company_id as string | undefined) ?? null,
          title: String(body?.title ?? ''), currency: String(body?.currency), closed_at: null, external_refs: (body?.external_refs as Record<string, string> | undefined) ?? {},
        }
        deals.set(d.id, d)
        return { status: 201, body: { data: d } }
      })
    }
    const dealRoute = /^\/api\/v1\/deals\/([^/]+)(\/stage)?$/.exec(url.pathname)
    if (dealRoute) {
      const d = deals.get(dealRoute[1]!)
      if (!d) return send(404, { error: { code: 'not_found', message: 'No such deal.' } })
      if (dealRoute[2] && req.method === 'POST') {
        return replayable(() => {
          const pipeline = pipelines.find((p) => p.id === d.pipeline_id)!
          if (!pipeline.stages.some((st) => st.id === body?.stage_id)) return { status: 422, body: { error: { code: 'invalid_request', message: 'That stage is not in the deal’s pipeline.' } } }
          d.stage_id = String(body?.stage_id)
          moves.push({ deal: d.id, stage: d.stage_id })
          return { status: 200, body: { data: d } }
        })
      }
      if (!dealRoute[2] && req.method === 'PATCH') {
        if (body && ('stage_id' in body || 'pipeline_id' in body)) return send(422, { error: { code: 'invalid_request', message: 'Move a deal with POST /deals/:id/stage; its pipeline does not change.' } })
        if (body && 'external_refs' in body) d.external_refs = body.external_refs as Record<string, string>
        return send(200, { data: d })
      }
    }

    if (url.pathname === '/api/v1/activities' && req.method === 'POST') {
      return replayable(() => {
        if (body?.kind !== 'note') return { status: 422, body: { error: { code: 'invalid_request', message: 'A key may log a note, call, meeting or email.' } } }
        n += 1
        const a: FakeActivity = {
          id: `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`, kind: String(body.kind), subject: (body.subject as string | undefined) ?? null, body: (body.body as string | undefined) ?? null,
          occurred_at: (body.occurred_at as string | undefined) ?? null, company_id: (body.company_id as string | undefined) ?? null, deal_id: (body.deal_id as string | undefined) ?? null,
        }
        activities.push(a)
        return { status: 201, body: { data: a } }
      })
    }

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
    pipelines,
    deals,
    activities,
    moves,
    addCustomerPipeline(names = ['Signed up', 'Onboarding', 'Live', 'Adopting']) {
      const p: FakePipeline = { id: `00000000-0000-4000-b000-${String(pipelines.length + 1).padStart(12, '0')}`, name: 'ConTrak customers', stages: [] }
      names.forEach((name, i) => p.stages.push({ id: `${p.id.slice(0, -2)}0${i}`.replace(/^(.{23})(.*)$/, '$1$2'), name, position: i + 1 }))
      pipelines.push(p)
      return p
    },
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
      pipelines.length = 0
      deals.clear()
      activities.length = 0
      moves.length = 0
      replays.clear()
      requests.length = 0
      state.script = []
      n = 0
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
