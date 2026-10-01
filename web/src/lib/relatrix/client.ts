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

export function classifyStatus(status: number): FailureKind {
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

export interface CompanyInput {
  name: string
  domain?: string
  notes?: string
  source?: string | null
  tags?: string[]
  external_refs?: Record<string, string>
}

export interface RelatrixClient {
  /** Proves the key works and the address is Relatrix: a read that needs the least scope. */
  health(): Promise<void>
  findCompanyByExternalRef(app: string, id: string): Promise<Company | null>
  createCompany(input: CompanyInput, idempotencyKey: string): Promise<Company>
  updateCompany(id: string, patch: Partial<Omit<CompanyInput, 'domain'>>, idempotencyKey: string): Promise<Company>
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

  return {
    async health() {
      const r = await request('GET', '/api/v1/pipelines?limit=1')
      if (!Array.isArray(asObject(r.body)?.data)) throw new RelatrixError('refused', 'That address did not answer like Relatrix.', r.status, null, null)
    },

    async findCompanyByExternalRef(app, id) {
      const r = await request('GET', `/api/v1/companies?external_ref%5B${encodeURIComponent(app)}%5D=${encodeURIComponent(id)}&limit=2`)
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
  }
}
