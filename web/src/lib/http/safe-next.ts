// Post-login return path (?next=…). Only same-site absolute paths are allowed,
// so a crafted link can't bounce someone to another site after they sign in.
// No imports: used by middleware, server actions and node:test.

export function safeNextPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.trim()
  if (!p.startsWith('/')) return null // must be a path on this site
  if (p.startsWith('//') || p.startsWith('/\\')) return null // protocol-relative → other host
  if (/[\\\u0000-\u001f\u007f]/.test(p)) return null // backslashes / control chars
  if (p.length > 2048) return null
  return p
}

export function invitePath(token: string): string {
  return `/invite/company?token=${encodeURIComponent(token)}`
}
