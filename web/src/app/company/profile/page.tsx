import { requireActiveCompany } from '@/lib/context/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CapabilityPicker } from '@/components/capability-picker'
import { groupCatalog, type CatalogEntry } from '@/lib/companies/capabilities'
import { updateCompanyProfile } from './actions'

interface Props {
  searchParams: Promise<{ error?: string; saved?: string }>
}

interface CompanyRow {
  legal_name: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  status: string
}

export default async function CompanyProfilePage({ searchParams }: Props) {
  const { supabase, company: active, isContractorAdmin: isAdmin } = await requireActiveCompany()

  const { data: rawCompany } = await supabase
    .from('contractor_companies')
    .select('legal_name, contact_name, contact_email, contact_phone, status')
    .eq('id', active.id)
    .maybeSingle()

  const company = rawCompany as CompanyRow | null

  const [{ data: rawCatalog }, { data: rawHeld }] = await Promise.all([
    supabase.from('capabilities').select('id, code, label, category, retired_at').order('category').order('label'),
    supabase.from('company_capabilities').select('capability_id, custom_label').eq('company_id', active.id),
  ])
  const catalog = (rawCatalog ?? []) as CatalogEntry[]
  const held = (rawHeld ?? []) as { capability_id: string | null; custom_label: string | null }[]
  const heldIds = new Set(held.flatMap((h) => (h.capability_id ? [h.capability_id] : [])))
  const customLabels = held.flatMap((h) => (h.custom_label ? [h.custom_label] : []))
  const groups = groupCatalog(catalog, heldIds)
  const heldNames = [...catalog.filter((e) => heldIds.has(e.id)).map((e) => e.label), ...customLabels]
  const { error, saved } = await searchParams

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Company Profile</h1>
        {company && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
              company.status === 'active'
                ? 'bg-green-100 text-green-800'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {company.status}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {saved && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Profile saved.
        </div>
      )}

      {isAdmin ? (
        <form action={updateCompanyProfile} className="space-y-5">
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Company details</h2>

            <div className="space-y-2">
              <Label htmlFor="legal_name">Legal name</Label>
              <Input
                id="legal_name"
                name="legal_name"
                defaultValue={company?.legal_name ?? ''}
                required
              />
            </div>

          </div>

          <div className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">What your company does</h2>
            <p className="text-xs text-muted-foreground">Clients you work with can see this, and filter by it.</p>
            <CapabilityPicker groups={groups} selected={heldIds} custom={customLabels.join('\n')} />
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Contact info</h2>

            <div className="space-y-2">
              <Label htmlFor="contact_name">Contact name</Label>
              <Input
                id="contact_name"
                name="contact_name"
                defaultValue={company?.contact_name ?? ''}
                placeholder="Jane Smith"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_email_display">Contact email</Label>
              <Input
                id="contact_email_display"
                value={company?.contact_email ?? ''}
                readOnly
                className="bg-muted text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Set at invite time — contact support to change.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_phone">Contact phone</Label>
              <Input
                id="contact_phone"
                name="contact_phone"
                type="tel"
                defaultValue={company?.contact_phone ?? ''}
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>

          <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            <span className="font-medium">Logo upload</span> — coming in a future update.
          </div>

          <Button type="submit">Save profile</Button>
        </form>
      ) : (
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <p className="font-medium">{company?.legal_name}</p>
          {heldNames.length > 0 && <p className="text-sm text-muted-foreground">{heldNames.join(', ')}</p>}
        </div>
      )}
    </div>
  )
}
