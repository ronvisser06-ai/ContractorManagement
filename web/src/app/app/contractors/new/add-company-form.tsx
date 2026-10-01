'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ADMIN_TYPES, isAdminType, type AdminType } from '@/lib/companies/labels'
import { createCompany, type AddCompanyState } from '../actions'

export interface OrgMemberOption {
  email: string
  name: string
}

interface Props {
  defaultName: string
  members: OrgMemberOption[]
}

const INITIAL: AddCompanyState = {}

// Create-a-new-company form. Client component so the typed values survive a
// server-side refusal (e.g. "possible duplicate" → confirm and resubmit).
export function AddCompanyForm({ defaultName, members }: Props) {
  const [state, formAction, pending] = useActionState(createCompany, INITIAL)
  const v = state.values ?? {}
  const [adminType, setAdminType] = useState<AdminType>(
    isAdminType(v.admin_type) ? v.admin_type : 'company_staff',
  )

  return (
    <form action={formAction} className="space-y-5 rounded-lg border bg-card p-4">
      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.error}
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Company</legend>
        <div className="space-y-2">
          <Label htmlFor="legal_name">Legal name</Label>
          <Input id="legal_name" name="legal_name" required defaultValue={v.legal_name ?? defaultName} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trade_types">Trades / work types (comma-separated)</Label>
          <Input id="trade_types" name="trade_types" placeholder="Scaffolding, Rigging" defaultValue={v.trade_types} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="business_number">Business number (optional)</Label>
            <Input id="business_number" name="business_number" defaultValue={v.business_number} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="website">Website (optional)</Label>
            <Input id="website" name="website" placeholder="example.com" defaultValue={v.website} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Company contact (optional)</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="contact_name">Name</Label>
            <Input id="contact_name" name="contact_name" defaultValue={v.contact_name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_email">Email</Label>
            <Input id="contact_email" name="contact_email" type="email" defaultValue={v.contact_email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_phone">Phone</Label>
            <Input id="contact_phone" name="contact_phone" type="tel" defaultValue={v.contact_phone} />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Company administrator</legend>
        <div className="space-y-2">
          {ADMIN_TYPES.map((t) => (
            <label key={t.value} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="admin_type"
                value={t.value}
                checked={adminType === t.value}
                onChange={() => setAdminType(t.value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {adminType === 'client_staff' ? (
          <div className="space-y-2">
            <Label htmlFor="staff_email">Choose a member of your organization</Label>
            <select
              id="staff_email"
              name="staff_email"
              required
              defaultValue={v.staff_email ?? ''}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="" disabled>
                Select a person…
              </option>
              {members.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="admin_email">Admin&apos;s email</Label>
            <Input id="admin_email" name="admin_email" type="email" required defaultValue={v.admin_email} />
            <p className="text-xs text-muted-foreground">
              They&apos;ll get an invitation that only works for this email address.
            </p>
          </div>
        )}
      </fieldset>

      {state.possibleDuplicate && (
        <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <input type="checkbox" name="confirm_not_duplicate" className="mt-1" />
          <span>Yes — this is a different company that happens to have the same name.</span>
        </label>
      )}

      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Creating…' : 'Create company and invite admin'}
      </Button>
    </form>
  )
}
