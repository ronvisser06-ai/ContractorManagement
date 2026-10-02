// F1 Step 5 — seed the F1 cast on the dev/test project (test data only).
//
//   node --env-file=.env.local scripts/seed-f1-personas.mjs            # (re)seed
//   node --env-file=.env.local scripts/seed-f1-personas.mjs --cleanup  # remove
//
// Cast (all f1-demo-*@example.com, one shared password):
//   Nora  — Client Admin @ "F1 Demo — Northwind Energy"
//   Ian   — foreman @ Northwind (becomes Apex's in-house admin in the story)
//   Hank  — Client Admin @ "F1 Demo — Harbor Refining"
//   Tess  — third-party admin @ "F1 Demo — Birch Electrical" (will also run Apex)
// "F1 Demo — Apex Scaffolding" is NOT seeded — the story creates it via the UI.
// Anything named "F1 Demo — …" (incl. companies created in the story) is
// removed by --cleanup. Password → web/.env.f1-personas.local (git-ignored).

import '../src/test/guard-not-production.mts' // never seed the production project
import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const CREDS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.f1-personas.local')
const PREFIX = 'F1 Demo — '
const EMAIL_LIKE = 'f1-demo-%@example.com'
const id = (p) => `${p}${ulid()}`

async function must(label, promise) {
  const { data, error } = await promise
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function cleanup() {
  const orgs = await must('orgs', admin.from('organizations').select('id').like('name', `${PREFIX}%`))
  const cos = await must('companies', admin.from('contractor_companies').select('id').like('legal_name', `${PREFIX}%`))
  const users = await must('users', admin.from('users').select('id').like('primary_email', EMAIL_LIKE))
  const orgIds = orgs.map((o) => o.id), coIds = cos.map((c) => c.id), userIds = users.map((u) => u.id)

  if (coIds.length) {
    await must('invites', admin.from('invitations').delete().in('company_id', coIds))
    await must('links', admin.from('client_company_links').delete().in('company_id', coIds))
    await must('company memberships', admin.from('company_memberships').delete().in('company_id', coIds))
  }
  if (orgIds.length) {
    await must('org invites', admin.from('invitations').delete().in('org_id', orgIds))
    await must('org links', admin.from('client_company_links').delete().in('org_id', orgIds))
    await must('org memberships', admin.from('org_memberships').delete().in('org_id', orgIds))
  }
  if (userIds.length) {
    // invitations created by these people for companies outside the prefix (none expected)
    await must('user invites', admin.from('invitations').delete().in('created_by', userIds))
    await must('user company memberships', admin.from('company_memberships').delete().in('user_id', userIds))
  }
  if (coIds.length) await must('delete companies', admin.from('contractor_companies').delete().in('id', coIds))
  if (orgIds.length) await must('delete orgs', admin.from('organizations').delete().in('id', orgIds))
  if (userIds.length) {
    await must('emails', admin.from('user_emails').delete().in('user_id', userIds))
    await must('profiles', admin.from('users').delete().in('id', userIds))
    for (const u of userIds) await admin.auth.admin.deleteUser(u)
  }
  if (existsSync(CREDS_FILE)) unlinkSync(CREDS_FILE)
  console.log(`Removed: ${orgIds.length} org(s), ${coIds.length} company(ies), ${userIds.length} user(s).`)
}

async function seed() {
  await cleanup()
  const password = `F1demo-${randomBytes(9).toString('base64url')}`
  const people = {}
  for (const [key, given, family] of [['nora', 'Nora', 'Northwind'], ['ian', 'Ian', 'Inhouse'], ['hank', 'Hank', 'Harbor'], ['tess', 'Tess', 'Thirdparty']]) {
    const data = await must(`user ${key}`, admin.auth.admin.createUser({
      email: `f1-demo-${key}@example.com`, password, email_confirm: true,
      user_metadata: { given_name: given, family_name: family },
    }))
    people[key] = data.user.id
  }

  const northwind = id('org_'), harbor = id('org_'), birch = id('cco_')
  await must('orgs', admin.from('organizations').insert([
    { id: northwind, name: `${PREFIX}Northwind Energy` },
    { id: harbor, name: `${PREFIX}Harbor Refining` },
  ]))
  await must('org memberships', admin.from('org_memberships').insert([
    { id: id('om_'), user_id: people.nora, org_id: northwind, roles: ['client_admin'], status: 'active' },
    { id: id('om_'), user_id: people.ian, org_id: northwind, roles: ['foreman'], status: 'active' },
    { id: id('om_'), user_id: people.hank, org_id: harbor, roles: ['client_admin'], status: 'active' },
  ]))
  await must('birch', admin.from('contractor_companies').insert({ id: birch, legal_name: `${PREFIX}Birch Electrical`, trade_types: ['Electrical'] }))
  await must('tess @ birch', admin.from('company_memberships').insert({
    id: id('mem_'), user_id: people.tess, company_id: birch, roles: ['contractor_admin'],
    admin_type: 'third_party', onboarding_status: 'account_created', status: 'active',
  }))

  writeFileSync(CREDS_FILE, `# F1 personas (git-ignored). Remove with --cleanup.\nF1_DEMO_PASSWORD=${password}\n`)
  console.log('Seeded F1 cast: f1-demo-{nora,ian,hank,tess}@example.com — shared password in', CREDS_FILE)
}

try {
  if (process.argv.includes('--cleanup')) await cleanup()
  else await seed()
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
}
