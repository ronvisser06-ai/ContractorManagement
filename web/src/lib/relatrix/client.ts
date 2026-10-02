// A small typed client for the Relatrix CRM API (/api/v1). No dependency: the stack is locked, and Relatrix's own
// generated client is a private package. It does only what the integration needs, and it is careful about three things.
//
//   * The key goes in one header to one origin. Redirects are refused (`redirect: 'error'`), so a moved or
//     hijacked address cannot be handed the key, and no error, message or log line ever contains it.
//   * Every write carries an Idempotency-Key, so a resend after a lost answer returns the first answer instead of
//     making a second record.
//   * An outcome is classified for the caller: a refusal that resending cannot fix, a fault that may pass, and a
//     key or scope problem that a person has to fix. (sync.ts decides what to do about each.)

export interface RelatrixClientOptions {
  baseUrl: string
  apiKey: string
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch
  timeoutMs?: number
}

export type FailureKind =
  /** 401 or 403: the key is wrong, revoked, or lacks a scope. A person must fix it; resending cannot. */
  | 'auth'
  /** 400, 404, 409, 422 and the like: Relatrix understood and refused. The same request will be refused again. */
  | 'refused'
  /** 408, 425, 429, 5xx, no answer, a dropped connection: may pass on its own. The request may have landed. */
  | 'transient'
  /** Relatrix is reachable and the key works, but something ConTrak needs is not set up there (a pipeline, a stage). A person must set it up; resending cannot. */
  | 'setup'

export class RelatrixError extends Error {
  readonly kind: FailureKind
  /** The HTTP status, or null when there was no answer at all. */
  readonly status: number | null
  readonly code: string | null
  readonly retryAfterSeconds: number | null

  constructor(kind: FailureKind, message: string, status: number | null, code: string | null, retryAfterSeconds: number | null) {
    super(message)
    this.name = 'RelatrixError'
    this.kind = kind
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function classifyStatus(status: number): Exclude<FailureKind, 'setup'> {
  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'transient'
  return 'refused'
}

export interface Company {
  id: string
  name: string
  source: string | null
  tags: string[]
  external_refs: Record<string, string>
}

export interface RelationshipType {
  id: string
  code: string
  from_kind: string
  to_kind: string
  retired_at: string | null
}

export interface Relationship {
  id: string
  type_id: string
  from_company_id: string | null
  to_company_id: string | null
  ended_on: string | null
}

export interface RelationshipInput {
  /** The type's code, e.g. "uses-contractor". */
  type: string
  from_company_id: string
  to_company_id: string
  started_on?: string
}

export interface CompanyInput {
  name: string
  domain?: string
  notes?: string
  source?: string | null
  tags?: string[]
  external_refs?: Record<string, string>
}

export interface Stage {
  id: string
  name: string
  position: number
}

export interface Pipeline {
  id: string
  name: string
  stages: Stage[]
}

export interface Deal {
  id: string
  pipeline_id: string
  stage_id: string
  company_id: string | null
  title: string
  closed_at: string | null
  external_refs: Record<string, string>
}

export interface DealInput {
  pipeline_id: string
  stage_id: string
  title: string
  currency: string
  company_id?: string
  external_refs?: Record<string, string>
}

export interface ActivityInput {
  kind: 'note'
  subject: string
  body?: string
  occurred_at?: string
  company_id?: string
  deal_id?: string
}

export interface RelatrixClient {
  /** Proves the key works and the address is Relatrix: a read that needs the least scope. */
  health(): Promise<void>
  findCompanyByExternalRef(app: string, id: string): Promise<Company | null>
  createCompany(input: CompanyInput, idempotencyKey: string): Promise<Company>
  /** `external_refs` REPLACES the whole map in Relatrix, so send the merged map. */
  updateCompany(id: string, patch: Partial<Omit<CompanyInput, 'domain'>>, idempotencyKey: string): Promise<Company>
  /** Companies whose name (or legal name or alias) is exactly this, ignoring case. */
  findCompaniesByName(name: string): Promise<Company[]>
  /** Companies with this website domain, as the primary one or any other. */
  findCompaniesByDomain(domain: string): Promise<Company[]>
  /** A relationship type by its code; null if the workspace has none. */
  findRelationshipType(code: string): Promise<RelationshipType | null>
  /** Every relationship of one type that touches a company. */
  findRelationships(type: string, companyId: string): Promise<Relationship[]>
  createRelationship(input: RelationshipInput, idempotencyKey: string): Promise<Relationship>
  /** Ends an edge (a date) or brings it back (null). Relatrix never deletes one through the API. */
  updateRelationship(id: string, patch: { ended_on: string | null }, idempotencyKey: string): Promise<Relationship>
  /** A pipeline by its exact name (case-insensitive), with its stages in order; null if there is none. */
  findPipelineByName(name: string): Promise<Pipeline | null>
  findDealByExternalRef(app: string, id: string): Promise<Deal | null>
  createDeal(input: DealInput, idempotencyKey: string): Promise<Deal>
  /** Changes a deal's fields. `external_refs` REPLACES the whole map in Relatrix, so send the merged map. */
  updateDeal(id: string, patch: { external_refs?: Record<string, string> }, idempotencyKey: string): Promise<Deal>
  /** The only way Relatrix lets a deal's stage change. */
  moveDeal(id: string, stageId: string, idempotencyKey: string): Promise<Deal>
  createActivity(input: ActivityInput, idempotencyKey: string): Promise<{ id: string }>
}

interface Reply {
  status: number
  body: unknown
}

const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export function createRelatrixClient(options: RelatrixClientOptions): RelatrixClient {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  const base = options.baseUrl.replace(/\/$/, '')

  async function request(method: 'GET' | 'POST' | 'PATCH', path: string, init: { body?: unknown; idempotencyKey?: string } = {}): Promise<Reply> {
    const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.idempotencyKey) headers['idempotency-key'] = init.idempotencyKey

    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      // No answer. The request may or may not have landed. Never echo `e`: its text can name the URL.
      const timedOut = e instanceof Error && e.name === 'TimeoutError'
      throw new RelatrixError('transient', timedOut ? 'Relatrix did not answer in time.' : 'The connection to Relatrix failed.', null, null, null)
    }

    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (response.ok) return { status: response.status, body }

    const error = asObject(asObject(body)?.error)
    const code = typeof error?.code === 'string' ? error.code : null
    // A sentence from Relatrix, capped; never anything else from the response.
    const said = typeof error?.message === 'string' ? error.message.slice(0, 200) : `Relatrix answered ${response.status}.`
    const retry = Number(response.headers.get('retry-after'))
    throw new RelatrixError(classifyStatus(response.status), said, response.status, code, Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : null)
  }

  const company = (body: unknown): Company => {
    const data = asObject(asObject(body)?.data)
    if (!data || typeof data.id !== 'string') throw new RelatrixError('refused', 'That did not answer like Relatrix.', null, null, null)
    return {
      id: data.id,
      name: typeof data.name === 'string' ? data.name : '',
      source: typeof data.source === 'string' ? data.source : null,
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string') : [],
      external_refs: (asObject(data.external_refs) ?? {}) as Record<string, string>,
    }
  }

  const deal = (body: unknown): Deal => {
    const data = asObject(asObject(body)?.data)
    if (!data || typeof data.id !== 'string' || typeof data.stage_id !== 'string') throw new RelatrixError('refused', 'That did not answer like Relatrix.', null, null, null)
    return {
      id: data.id,
      pipeline_id: typeof data.pipeline_id === 'string' ? data.pipeline_id : '',
      stage_id: data.stage_id,
      company_id: typeof data.company_id === 'string' ? data.company_id : null,
      title: typeof data.title === 'string' ? data.title : '',
      closed_at: typeof data.closed_at === 'string' ? data.closed_at : null,
      external_refs: (asObject(data.external_refs) ?? {}) as Record<string, string>,
    }
  }

  const relationship = (data: unknown): Relationship => {
    const d = asObject(data)
    if (!d || typeof d.id !== 'string') throw new RelatrixError('refused', 'That did not answer like Relatrix.', null, null, null)
    return {
      id: d.id,
      type_id: typeof d.type_id === 'string' ? d.type_id : '',
      from_company_id: typeof d.from_company_id === 'string' ? d.from_company_id : null,
      to_company_id: typeof d.to_company_id === 'string' ? d.to_company_id : null,
      ended_on: typeof d.ended_on === 'string' ? d.ended_on : null,
    }
  }

  const companyList = async (query: string): Promise<Company[]> => {
    const r = await request('GET', `/api/v1/companies?${query}&limit=20`)
    const data = asObject(r.body)?.data
    if (!Array.isArray(data)) throw new RelatrixError('refused', 'That did not answer like Relatrix.', r.status, null, null)
    return data.map((d) => company({ data: d }))
  }

  const refQuery = (app: string, id: string) => `external_ref%5B${encodeURIComponent(app)}%5D=${encodeURIComponent(id)}`

  return {
    async health() {
      const r = await request('GET', '/api/v1/pipelines?limit=1')
      if (!Array.isArray(asObject(r.body)?.data)) throw new RelatrixError('refused', 'That address did not answer like Relatrix.', r.status, null, null)
    },

    async findCompanyByExternalRef(app, id) {
      const r = await request('GET', `/api/v1/companies?${refQuery(app, id)}&limit=2`)
      const data = asObject(r.body)?.data
      if (!Array.isArray(data)) throw new RelatrixError('refused', 'That did not answer like Relatrix.', r.status, null, null)
      if (data.length > 1) throw new RelatrixError('refused', `More than one Relatrix company has ${app} id ${id}.`, null, 'ambiguous', null)
      return data.length === 1 ? company({ data: data[0] }) : null
    },

    async createCompany(input, idempotencyKey) {
      return company((await request('POST', '/api/v1/companies', { body: input, idempotencyKey })).body)
    },

    async updateCompany(id, patch, idempotencyKey) {
      return company((await request('PATCH', `/api/v1/companies/${encodeURIComponent(id)}`, { body: patch, idempotencyKey })).body)
    },

    findCompaniesByName: (name) => companyList(`name=${encodeURIComponent(name)}`),
    findCompaniesByDomain: (domain) => companyList(`domain=${encodeURIComponent(domain)}`),

    async findRelationshipType(code) {
      const r = await request('GET', '/api/v1/relationship-types')
      const data = asObject(r.body)?.data
      if (!Array.isArray(data)) throw new RelatrixError('refused', 'That did not answer like Relatrix.', r.status, null, null)
      const found = data.map(asObject).filter((t): t is Record<string, unknown> => t !== null && t.code === code)
      const t = found[0]
      if (!t || typeof t.id !== 'string') return null
      return {
        id: t.id,
        code,
        from_kind: typeof t.from_kind === 'string' ? t.from_kind : '',
        to_kind: typeof t.to_kind === 'string' ? t.to_kind : '',
        retired_at: typeof t.retired_at === 'string' ? t.retired_at : null,
      }
    },

    async findRelationships(type, companyId) {
      const out: Relationship[] = []
      let cursor: string | null = null
      // A company with more than a few pages of one type of edge is not a case this integration has.
      for (let page = 0; page < 10; page += 1) {
        const r = await request('GET', `/api/v1/relationships?type=${encodeURIComponent(type)}&company_id=${encodeURIComponent(companyId)}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
        const body = asObject(r.body)
        if (!Array.isArray(body?.data)) throw new RelatrixError('refused', 'That did not answer like Relatrix.', r.status, null, null)
        out.push(...body.data.map(relationship))
        cursor = typeof body.next_cursor === 'string' ? body.next_cursor : null
        if (!cursor) return out
      }
      throw new RelatrixError('refused', 'That company has too many relationships to read.', null, 'too_many', null)
    },

    async createRelationship(input, idempotencyKey) {
      return relationship(asObject((await request('POST', '/api/v1/relationships', { body: input, idempotencyKey })).body)?.data)
    },

    async updateRelationship(id, patch, idempotencyKey) {
      return relationship(asObject((await request('PATCH', `/api/v1/relationships/${encodeURIComponent(id)}`, { body: patch, idempotencyKey })).body)?.data)
    },

    async findPipelineByName(name) {
      const r = await request('GET', '/api/v1/pipelines')
      const data = asObject(r.body)?.data
      if (!Array.isArray(data)) throw new RelatrixError('refused', 'That did not answer like Relatrix.', r.status, null, null)
      const found = data.map(asObject).filter((p): p is Record<string, unknown> => p !== null).filter((p) => typeof p.name === 'string' && p.name.trim().toLowerCase() === name.trim().toLowerCase())
      if (found.length > 1) throw new RelatrixError('setup', `There is more than one pipeline called “${name}” in Relatrix.`, null, 'ambiguous', null)
      const p = found[0]
      if (!p || typeof p.id !== 'string') return null
      const stages = (Array.isArray(p.stages) ? p.stages : [])
        .map(asObject)
        .filter((x): x is Record<string, unknown> => x !== null && typeof x.id === 'string' && typeof x.name === 'string')
        .map((x) => ({ id: x.id as string, name: x.name as string, position: typeof x.position === 'number' ? x.position : 0 }))
        .sort((a, b) => a.position - b.position)
      return { id: p.id, name: p.name as string, stages }
    },

    async findDealByExternalRef(app, id) {
      const r = await request('GET', `/api/v1/deals?${refQuery(app, id)}&limit=2`)
      const data = asObject(r.body)?.data
      if (!Array.isArray(data)) throw new RelatrixError('refused', 'That did not answer like Relatrix.', r.status, null, null)
      if (data.length > 1) throw new RelatrixError('refused', `More than one Relatrix deal has ${app} id ${id}.`, null, 'ambiguous', null)
      return data.length === 1 ? deal({ data: data[0] }) : null
    },

    async createDeal(input, idempotencyKey) {
      return deal((await request('POST', '/api/v1/deals', { body: input, idempotencyKey })).body)
    },

    async updateDeal(id, patch, idempotencyKey) {
      return deal((await request('PATCH', `/api/v1/deals/${encodeURIComponent(id)}`, { body: patch, idempotencyKey })).body)
    },

    async moveDeal(id, stageId, idempotencyKey) {
      return deal((await request('POST', `/api/v1/deals/${encodeURIComponent(id)}/stage`, { body: { stage_id: stageId }, idempotencyKey })).body)
    },

    async createActivity(input, idempotencyKey) {
      const data = asObject(asObject((await request('POST', '/api/v1/activities', { body: input, idempotencyKey })).body)?.data)
      if (!data || typeof data.id !== 'string') throw new RelatrixError('refused', 'That did not answer like Relatrix.', null, null, null)
      return { id: data.id }
    },
  }
}
