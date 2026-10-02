import type { CatalogGroup } from '@/lib/companies/capabilities'

/**
 * Tick capabilities from the shared catalog, and add any that are not on it. Plain inputs, so it works inside any form:
 * the ticked boxes post as repeated `capability` fields and the extras as `custom_capabilities`, one per line.
 * `postsAs` chooses what a ticked box posts: the entry's id (a company's own profile) or its label (the form that
 * defines a company, which hands labels to the database to match).
 */
export function CapabilityPicker({
  groups,
  selected,
  custom,
  postsAs = 'id',
}: {
  groups: CatalogGroup[]
  /** Ids (or labels, with postsAs="label") that start ticked. */
  selected: ReadonlySet<string>
  custom: string
  postsAs?: 'id' | 'label'
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const ticked = g.entries.filter((e) => selected.has(postsAs === 'id' ? e.id : e.label)).length
        return (
          <details key={g.category} open={ticked > 0} className="rounded-md border bg-background">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
              {g.category}
              {ticked > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{ticked} chosen</span>}
            </summary>
            <ul className="grid gap-1 px-3 pb-3 sm:grid-cols-2">
              {g.entries.map((e) => (
                <li key={e.id}>
                  <label className="flex items-start gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      name="capability"
                      value={postsAs === 'id' ? e.id : e.label}
                      defaultChecked={selected.has(postsAs === 'id' ? e.id : e.label)}
                      className="mt-1"
                    />
                    <span>
                      {e.label}
                      {e.retired_at && <span className="ml-1 text-xs text-muted-foreground">(no longer offered)</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </details>
        )
      })}
      <div className="space-y-1">
        <label htmlFor="custom_capabilities" className="text-sm font-medium">
          Anything else you do
        </label>
        <textarea
          id="custom_capabilities"
          name="custom_capabilities"
          rows={3}
          defaultValue={custom}
          placeholder="One per line, for work that is not in the list"
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
        <p className="text-xs text-muted-foreground">A name that matches one in the list is filed under it.</p>
      </div>
    </div>
  )
}
