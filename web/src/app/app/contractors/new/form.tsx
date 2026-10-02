'use client'

import { useActionState, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CapabilityPicker } from '@/components/capability-picker'
import type { CatalogGroup } from '@/lib/companies/capabilities'
import { defineCompanyAction, type FormState } from './actions'

interface Member {
  userId: string
  name: string
  email: string
}

const ADMIN_TYPES = [
  { value: 'in_house', label: 'Someone in our organization', hint: 'They become the company’s admin straight away.' },
  { value: 'external', label: 'Someone at the company', hint: 'We email them an invitation to set the company up.' },
  { value: 'third_party', label: 'A third party acting for the company', hint: 'A consultant or agency person. Invited the same way, and recorded as a third party.' },
] as const

export function NewCompanyForm({ members, groups }: { members: Member[]; groups: CatalogGroup[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(defineCompanyAction, {})
  const v = state.values ?? {}
  const [type, setType] = useState<string>(v.admin_type ?? 'external')
  const matches = state.matches ?? []

  return (
    <form action={action} className="space-y-6">
      {state.error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </div>
      )}

      {matches.length > 0 && (
        <section className="space-y-3 rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          <h2 className="font-medium">A company like this is already on the platform</h2>
          <p>Another organization may have added it. Link to it rather than creating a second record: its administrator will be asked to accept.</p>
          <ul className="space-y-2">
            {matches.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white px-3 py-2">
                <span className="font-medium">{m.name}</span>
                {m.alreadyLinked ? (
                  <span className="text-xs">Already linked to you</span>
                ) : (
                  <Button type="submit" name="decision" value={`link:${m.id}`} variant="outline" disabled={pending}>
                    Link to this company
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button type="submit" name="decision" value="anyway" variant="ghost" disabled={pending}>
            None of these: create a new company anyway
          </Button>
        </section>
      )}

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-medium">The company</h2>
        <div className="space-y-2">
          <Label htmlFor="legal_name">Legal name</Label>
          <Input id="legal_name" name="legal_name" required maxLength={200} defaultValue={v.legal_name ?? ''} autoFocus />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contact_name">Contact name</Label>
            <Input id="contact_name" name="contact_name" defaultValue={v.contact_name ?? ''} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact_phone">Contact phone</Label>
            <Input id="contact_phone" name="contact_phone" type="tel" defaultValue={v.contact_phone ?? ''} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="contact_email">Contact email</Label>
          <Input id="contact_email" name="contact_email" type="email" defaultValue={v.contact_email ?? ''} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">What it does</p>
          <CapabilityPicker groups={groups} selected={new Set(state.selected ?? [])} custom={v.custom_capabilities ?? ''} postsAs="label" />
        </div>
      </section>

      <fieldset className="space-y-3 rounded-lg border bg-card p-4">
        <legend className="px-1 text-sm font-medium">Who administers it?</legend>
        {ADMIN_TYPES.map((t) => (
          <label key={t.value} className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="radio" name="admin_type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} className="mt-1" />
            <span>
              <span className="font-medium">{t.label}</span>
              <span className="block text-xs text-muted-foreground">{t.hint}</span>
            </span>
          </label>
        ))}
        {type === 'in_house' ? (
          <div className="space-y-2 pt-2">
            <Label htmlFor="admin_user_id">Member</Label>
            <select id="admin_user_id" name="admin_user_id" defaultValue={v.admin_user_id ?? ''} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">
              <option value="">Choose…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.email})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-2 pt-2">
            <Label htmlFor="admin_email">Admin’s email</Label>
            <Input id="admin_email" name="admin_email" type="email" defaultValue={v.admin_email ?? ''} />
          </div>
        )}
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Add company'}
      </Button>
    </form>
  )
}
