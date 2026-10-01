// F0 Step 5 — seed the multi-membership test persona (test data only).
//
//   node --env-file=.env.local scripts/seed-f0-persona.mjs            # (re)seed
//   node --env-file=.env.local scripts/seed-f0-persona.mjs --cleanup  # remove
//
// Persona: Contractor Admin at "Apex Scaffolding", Worker at "Birch Electrical",
// Client Admin at "Northwind Energy". Plus a site, the Apex↔Northwind link and
// site assignment, and two Apex workers (one active on the site) so every page
// has something to show. Everything is named "F0 Demo — …" / f0-demo-*@example.com.
//
// The persona's sign-in is written to web/.env.f0-persona.local (git-ignored);
// the password is never printed.

import '../src/test/guard-not-production.mts' // never seed the production project
import { randomBytes } from 'node:crypto'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { ulid } from 'ulid'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !SERVICE_KEY) throw new Error('Run with: node --env-file=.env.local scripts/seed-f0-persona.mjs')

const admin = createClient(URL_, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const CREDS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.f0-persona.local')
const PREFIX = 'F0 Demo — '
const EMAIL_LIKE = 'f0-demo-%@example.com'
const PERSONA_EMAIL = 'f0-demo-persona@example.com'
const newId = (p) => `${p}${ulid()}`

async function must(label, promise) {
  const { data, error } = await promise
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

async function cleanup() {
  const orgs = await must('find orgs', admin.from('organizations').select('id').like('name', `${PREFIX}%`))
  const cos = await must('find companies', admin.from('contractor_companies').select('id').like('legal_name', `${PREFIX}%`))
  const users = await must('find users', admin.from('users').select('id').like('primary_email', EMAIL_LIKE))
  const orgIds = orgs.map((o) => o.id)
  const coIds = cos.map((c) => c.id)
  const userIds = users.map((u) => u.id)
  const sites = orgIds.length ? await must('find sites', admin.from('sites').select('id').in('org_id', orgIds)) : []
  const siteIds = sites.map((s) => s.id)

  if (siteIds.length) {
    await must('activations', admin.from('site_worker_activations').delete().in('site_id', siteIds))
    await must('assignments', admin.from('site_company_assignments').delete().in('site_id', siteIds))
  }
  if (coIds.length) {
    await must('links', admin.from('client_company_links').delete().in('company_id', coIds))
    await must('company invites', admin.from('invitations').delete().in('company_id', coIds))
    await must('company memberships', admin.from('company_memberships').delete().in('company_id', coIds))
  }
  if (orgIds.length) {
    await must('org invites', admin.from('invitations').delete().in('org_id', orgIds))
    await must('org memberships', admin.from('org_memberships').delete().in('org_id', orgIds))
    await must('sites', admin.from('sites').delete().in('org_id', orgIds))
  }
  if (coIds.length) await must('companies', admin.from('contractor_companies').delete().in('id', coIds))
  if (orgIds.length) await must('orgs', admin.from('organizations').delete().in('id', orgIds))
  if (userIds.length) {
    await must('user emails', admin.from('user_emails').delete().in('user_id', userIds))
    await must('users', admin.from('users').delete().in('id', userIds))
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
  }
  if (existsSync(CREDS_FILE)) unlinkSync(CREDS_FILE)
  console.log(`Removed: ${orgIds.length} org(s), ${coIds.length} company(ies), ${siteIds.length} site(s), ${userIds.length} user(s).`)
}

async function createUser(email, given, family, password) {
  const data = await must(`create ${email}`, admin.auth.admin.createUser({
    email,
    password: password ?? randomBytes(24).toString('base64url'),
    email_confirm: true,
    user_metadata: { given_name: given, family_name: family },
  }))
  return data.user.id
}

async function seed() {
  await cleanup() // idempotent: always start from a clean slate

  const password = `F0demo-${randomBytes(9).toString('base64url')}`
  const persona = await createUser(PERSONA_EMAIL, 'Dana', 'Demo', password)
  const worker1 = await createUser('f0-demo-worker1@example.com', 'Sam', 'Scaffold')
  const worker2 = await createUser('f0-demo-worker2@example.com', 'Riley', 'Rigger')

  const orgId = newId('org_')
  const siteId = newId('site_')
  const apex = newId('cco_')
  const birch = newId('cco_')

  await must('org', admin.from('organizations').insert({ id: orgId, name: `${PREFIX}Northwind Energy` }))
  await must('site', admin.from('sites').insert({ id: siteId, org_id: orgId, name: `${PREFIX}North Plant`, orientation_validity_months: 12 }))
  await must('companies', admin.from('contractor_companies').insert([
    { id: apex, legal_name: `${PREFIX}Apex Scaffolding`, trade_types: ['Scaffolding', 'Rigging'], contact_name: 'Dana Demo', contact_email: PERSONA_EMAIL },
    { id: birch, legal_name: `${PREFIX}Birch Electrical`, trade_types: ['Electrical'] },
  ]))

  // Memberships — inserted in this order so the default (oldest) company is Apex.
  await must('org membership', admin.from('org_memberships').insert({ id: newId('om_'), user_id: persona, org_id: orgId, roles: ['client_admin'], status: 'active' }))
  const membership = (userId, companyId, roles) => ({ id: newId('mem_'), user_id: userId, company_id: companyId, roles, onboarding_status: 'account_created', status: 'active' })
  await must('apex admin', admin.from('company_memberships').insert(membership(persona, apex, ['contractor_admin'])))
  await must('birch worker', admin.from('company_memberships').insert(membership(persona, birch, ['worker'])))
  await must('apex workers', admin.from('company_memberships').insert([membership(worker1, apex, ['worker']), membership(worker2, apex, ['worker'])]))

  // Bridge: Apex works for Northwind, is assigned to North Plant, Sam is on site.
  await must('link', admin.from('client_company_links').insert({ id: newId('ccl_'), org_id: orgId, company_id: apex, status: 'active', accepted_at: new Date().toISOString() }))
  await must('assignment', admin.from('site_company_assignments').insert({ id: newId('sca_'), site_id: siteId, company_id: apex, status: 'active' }))
  await must('activation', admin.from('site_worker_activations').insert({ id: newId('swa_'), site_id: siteId, company_id: apex, user_id: worker1, status: 'active', activated_by: persona }))

  writeFileSync(CREDS_FILE, `# F0 test persona (git-ignored). Remove with --cleanup.\nF0_DEMO_EMAIL=${PERSONA_EMAIL}\nF0_DEMO_PASSWORD=${password}\n`)
  console.log('Seeded F0 persona:')
  console.log(`  sign in as ${PERSONA_EMAIL} — password in ${CREDS_FILE}`)
  console.log('  Contractor Admin @ Apex Scaffolding · Worker @ Birch Electrical · Client Admin @ Northwind Energy')
}

try {
  if (process.argv.includes('--cleanup')) await cleanup()
  else await seed()
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
}
