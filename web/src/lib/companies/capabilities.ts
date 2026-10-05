// Capabilities as the screens use them (M2.5 F2b). Pure: no Next, no database, so a plain node test can drive it.

export interface CatalogEntry {
  id: string
  code: string
  label: string
  category: string
  retired_at: string | null
}

export interface CatalogGroup {
  category: string
  entries: CatalogEntry[]
}

/** The catalog grouped by category, in the order the categories first appear, entries by label. Retired entries only if held. */
export function groupCatalog(catalog: CatalogEntry[], heldIds: ReadonlySet<string>): CatalogGroup[] {
  const groups = new Map<string, CatalogEntry[]>()
  for (const e of catalog) {
    if (e.retired_at && !heldIds.has(e.id)) continue
    const list = groups.get(e.category) ?? []
    list.push(e)
    groups.set(e.category, list)
  }
  return [...groups].map(([category, entries]) => ({ category, entries: [...entries].sort((a, b) => a.label.localeCompare(b.label)) }))
}

/** Names typed one per line (a comma is part of a name: "Camp, catering and janitorial"): trimmed, blanks dropped, repeats (ignoring case) once. */
export function parseCustomLabels(text: string | null | undefined): string[] {
  return uniqueLabels((text ?? '').split(/\r?\n/))
}

/** The same tidying for a list already split: trimmed, blanks dropped, repeats (ignoring case) once, first spelling kept. */
export function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.replace(/\s+/g, ' ').trim()
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/** What a form hands the database: the catalog entries ticked, and the custom names typed. */
export function readCapabilityForm(f: { getAll(name: string): FormDataEntryValue[]; get(name: string): FormDataEntryValue | null }): { catalog: string[]; custom: string[] } {
  const catalog = [...new Set(f.getAll('capability').filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()))]
  const custom = f.get('custom_capabilities')
  return { catalog, custom: parseCustomLabels(typeof custom === 'string' ? custom : '') }
}

/** One capability a company holds, as the client sees it. */
export interface HeldCapability {
  /** The catalog code, or null for a name the company typed itself. */
  code: string | null
  label: string
}

/** What each company holds, from the rows the database returned (a catalog entry embedded, or a custom label). */
export function heldByCompany(
  rows: readonly { company_id: string; custom_label: string | null; capabilities: { code: string; label: string } | null }[],
): Map<string, HeldCapability[]> {
  const out = new Map<string, HeldCapability[]>()
  for (const r of rows) {
    const held: HeldCapability | null = r.capabilities ? { code: r.capabilities.code, label: r.capabilities.label } : r.custom_label ? { code: null, label: r.custom_label } : null
    if (!held) continue
    const list = out.get(r.company_id) ?? []
    list.push(held)
    out.set(r.company_id, list)
  }
  // Catalog entries first, then the company's own words, each by label.
  for (const list of out.values()) list.sort((a, b) => Number(a.code === null) - Number(b.code === null) || a.label.localeCompare(b.label))
  return out
}

/** The catalog capabilities at least one of these companies holds, with how many do, for the filter. */
export function filterOptions(held: ReadonlyMap<string, readonly HeldCapability[]>): { code: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const list of held.values()) {
    for (const h of list) {
      if (h.code === null) continue
      const cur = counts.get(h.code) ?? { label: h.label, count: 0 }
      cur.count += 1
      counts.set(h.code, cur)
    }
  }
  return [...counts].map(([code, v]) => ({ code, ...v })).sort((a, b) => a.label.localeCompare(b.label))
}

/** Keeps the companies that hold the capability with this code; no code keeps everything. */
export function holding<T extends { company_id: string }>(items: readonly T[], held: ReadonlyMap<string, readonly HeldCapability[]>, code: string | null): T[] {
  if (!code) return [...items]
  return items.filter((i) => (held.get(i.company_id) ?? []).some((h) => h.code === code))
}
