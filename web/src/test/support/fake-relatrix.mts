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

export interface FakeType {
  id: string
  code: string
  label: string
  from_kind: string
  to_kind: string
  retired_at: string | null
}

export interface FakeRelationship {
  id: string
  type_id: string
  from_company_id: string | null
  to_company_id: string | null
  started_on: string | null
  ended_on: string | null
}

export interface FakeVocabulary {
  id: string
  key: string
  name: string
  shared: boolean
}

export interface FakeTerm {
  id: string
  vocabulary_id: string
  code: string
  label: string
  retired_at: string | null
}

export interface FakeCapability {
  id: string
  company_id: string
  status: 'accepted' | 'proposed' | 'rejected'
  term_id: string | null
  free_text: string | null
  quote: string | null
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
  types: FakeType[]
  relationships: Map<string, FakeRelationship>
  vocabularies: FakeVocabulary[]
  terms: FakeTerm[]
  capabilities: FakeCapability[]
  /** The relationship type Ron creates by hand: "Uses contractor". */
  addUsesType(over?: Partial<FakeType>): FakeType
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
  const types: FakeType[] = []
  const relationships = new Map<string, FakeRelationship>()
  const vocabularies: FakeVocabulary[] = []
  const terms: FakeTerm[] = []
  const capabilities: FakeCapability[] = []
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

    // Vocabularies, terms and capabilities, as Relatrix's capabilities scope answers them (RelatrixCRM BUILD.md §6.5).
    if (url.pathname === '/api/v1/vocabularies' && req.method === 'GET') return send(200, { data: [{ id: 'shared-1', key: 'construction-services', name: 'Services', shared: true }, ...vocabularies] })
    if (url.pathname === '/api/v1/vocabularies' && req.method === 'POST') {
      return replayable(() => {
        if (vocabularies.some((v) => v.key === body?.key)) return { status: 409, body: { error: { code: 'conflict', message: 'That conflicts with a record that already exists.' } } }
        n += 1
        const v: FakeVocabulary = { id: `00000000-0000-4000-e000-${String(n).padStart(12, '0')}`, key: String(body?.key), name: String(body?.name), shared: false }
        vocabularies.push(v)
        return { status: 201, body: { data: v } }
      })
    }
    const vTerms = /^\/api\/v1\/vocabularies\/([^/]+)\/terms$/.exec(url.pathname)
    if (vTerms && req.method === 'GET') return send(200, { data: terms.filter((t) => t.vocabulary_id === vTerms[1] && (url.searchParams.get('retired') === 'true' || !t.retired_at)) })
    if (vTerms && req.method === 'POST') {
      return replayable(() => {
        if (!vocabularies.some((v) => v.id === vTerms[1])) return { status: 404, body: { error: { code: 'not_found', message: 'No such vocabulary.' } } }
        if (terms.some((t) => t.vocabulary_id === vTerms[1] && t.code === body?.code)) return { status: 409, body: { error: { code: 'conflict', message: 'That conflicts with a record that already exists.' } } }
        n += 1
        const t: FakeTerm = { id: `00000000-0000-4000-e100-${String(n).padStart(12, '0')}`, vocabulary_id: vTerms[1]!, code: String(body?.code), label: String(body?.label), retired_at: null }
        terms.push(t)
        return { status: 201, body: { data: t } }
      })
    }
    const caps = /^\/api\/v1\/companies\/([^/]+)\/capabilities$/.exec(url.pathname)
    if (caps && req.method === 'GET') return send(200, { data: capabilities.filter((c) => c.company_id === caps[1]) })
    if (caps && req.method === 'POST') {
      return replayable(() => {
        const termId = (body?.term_id as string | undefined) ?? null
        const text = (body?.free_text as string | undefined) ?? null
        if ((termId === null) === (text === null)) return { status: 422, body: { error: { code: 'invalid_request', message: 'Send either “term_id” or “free_text”.' } } }
        if (termId && !terms.some((t) => t.id === termId)) return { status: 422, body: { error: { code: 'invalid_request', message: 'No such term in this workspace or the shared vocabularies.' } } }
        if (termId && terms.find((t) => t.id === termId)!.retired_at) return { status: 422, body: { error: { code: 'invalid_request', message: 'That term is retired.' } } }
        // What is already there or waiting answers 200 and writes nothing; a rejected one does not count.
        const same = capabilities.find((c) => c.company_id === caps[1] && c.status !== 'rejected' && (termId ? c.term_id === termId : c.free_text?.toLowerCase() === text!.toLowerCase()))
        if (same) return { status: 200, body: { data: same } }
        n += 1
        const c: FakeCapability = { id: `00000000-0000-4000-e200-${String(n).padStart(12, '0')}`, company_id: caps[1]!, status: 'proposed', term_id: termId, free_text: text, quote: (body?.quote as string | undefined) ?? null }
        capabilities.push(c)
        return { status: 201, body: { data: c } }
      })
    }

    if (url.pathname === '/api/v1/relationship-types' && req.method === 'GET') return send(200, { data: types })

    if (url.pathname === '/api/v1/relationships' && req.method === 'GET') {
      const type = types.find((t) => t.code === url.searchParams.get('type'))
      const company = url.searchParams.get('company_id')
      const found = [...relationships.values()].filter((r) => (!type || r.type_id === type.id) && (!company || r.from_company_id === company || r.to_company_id === company))
      return send(200, { data: found, next_cursor: null })
    }
    if (url.pathname === '/api/v1/relationships' && req.method === 'POST') {
      return replayable(() => {
        const type = types.find((t) => t.code === body?.type)
        if (!type) return { status: 422, body: { error: { code: 'invalid_request', message: 'No such relationship type.' } } }
        if (!companies.has(String(body?.from_company_id)) || !companies.has(String(body?.to_company_id))) return { status: 422, body: { error: { code: 'invalid_request', message: 'Both ends must be records in this workspace.' } } }
        n += 1
        const r: FakeRelationship = {
          id: `00000000-0000-4000-c000-${String(n).padStart(12, '0')}`, type_id: type.id, from_company_id: String(body?.from_company_id), to_company_id: String(body?.to_company_id),
          started_on: (body?.started_on as string | undefined) ?? null, ended_on: null,
        }
        relationships.set(r.id, r)
        return { status: 201, body: { data: r } }
      })
    }
    const edge = /^\/api\/v1\/relationships\/([^/]+)$/.exec(url.pathname)
    if (edge && req.method === 'PATCH') {
      const r = relationships.get(edge[1]!)
      if (!r) return send(404, { error: { code: 'not_found', message: 'No such relationship.' } })
      if (body && 'ended_on' in body) r.ended_on = (body.ended_on as string | null) ?? null
      return send(200, { data: r })
    }

    if (url.pathname === '/api/v1/companies' && req.method === 'GET') {
      const refs = [...url.searchParams].filter(([k]) => k.startsWith('external_ref['))
      const name = url.searchParams.get('name')?.toLowerCase()
      const domain = url.searchParams.get('domain')
      const found = [...companies.values()].filter(
        (c) => refs.every(([k, v]) => c.external_refs[k.slice(13, -1)] === v) && (name === undefined || c.name.toLowerCase() === name) && (domain === null || c.domain === domain),
      )
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
      if (body && 'external_refs' in body) company.external_refs = body.external_refs as Record<string, string>
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
    types,
    relationships,
    vocabularies,
    terms,
    capabilities,
    addUsesType(over = {}) {
      const t: FakeType = { id: `00000000-0000-4000-d000-${String(types.length + 1).padStart(12, '0')}`, code: 'uses-contractor', label: 'Uses contractor', from_kind: 'company', to_kind: 'company', retired_at: null, ...over }
      types.push(t)
      return t
    },
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
      types.length = 0
      relationships.clear()
      vocabularies.length = 0
      terms.length = 0
      capabilities.length = 0
      moves.length = 0
      replays.clear()
      requests.length = 0
      state.script = []
      n = 0
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
