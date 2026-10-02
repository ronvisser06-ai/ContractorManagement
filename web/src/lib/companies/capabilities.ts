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
