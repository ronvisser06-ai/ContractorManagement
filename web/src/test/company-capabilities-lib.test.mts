import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupCatalog, parseCustomLabels, readCapabilityForm, uniqueLabels, type CatalogEntry } from '../lib/companies/capabilities.ts'

const e = (id: string, label: string, category: string, retired = false): CatalogEntry => ({ id, code: id, label, category, retired_at: retired ? '2026-01-01T00:00:00Z' : null })

test('custom names are one per line: a comma stays in the name, blanks go, repeats ignoring case are once', () => {
  assert.deepEqual(parseCustomLabels('Stonework\r\n  heritage   repair, and more \n\nSTONEWORK\n'), ['Stonework', 'heritage repair, and more'])
  assert.deepEqual(parseCustomLabels(null), [])
  assert.deepEqual(parseCustomLabels('   \n \n'), [])
})

test('a list already split is tidied the same way, keeping the first spelling', () => {
  assert.deepEqual(uniqueLabels([' Electrical ', 'electrical', 'Camp, catering and janitorial', '', 'ELECTRICAL']), ['Electrical', 'Camp, catering and janitorial'])
})

test('the catalog is grouped by category with entries by label, and a retired entry shows only to a company that holds it', () => {
  const catalog = [e('b', 'Welding', 'Mechanical'), e('a', 'Piping', 'Mechanical'), e('c', 'Roofing', 'Envelope'), e('r', 'Old trade', 'Envelope', true)]
  const groups = groupCatalog(catalog, new Set())
  assert.deepEqual(groups.map((g) => [g.category, g.entries.map((x) => x.label)]), [['Mechanical', ['Piping', 'Welding']], ['Envelope', ['Roofing']]])
  assert.deepEqual(groupCatalog(catalog, new Set(['r'])).find((g) => g.category === 'Envelope')!.entries.map((x) => x.label), ['Old trade', 'Roofing'])
  assert.deepEqual(groupCatalog([e('r', 'Old', 'Gone', true)], new Set()), [], 'a category with nothing to show is not shown')
})

test('a form hands over the ticked entries once each, and the extras typed', () => {
  const f = new FormData()
  for (const v of ['cap_a', ' cap_b ', 'cap_a', '']) f.append('capability', v)
  f.set('custom_capabilities', 'One\nTwo')
  assert.deepEqual(readCapabilityForm(f), { catalog: ['cap_a', 'cap_b'], custom: ['One', 'Two'] })
  assert.deepEqual(readCapabilityForm(new FormData()), { catalog: [], custom: [] })
})

import { filterOptions, heldByCompany, holding } from '../lib/companies/capabilities.ts'

const rows = [
  { company_id: 'c1', custom_label: null, capabilities: { code: 'welding', label: 'Welding and fabrication' } },
  { company_id: 'c1', custom_label: 'Stonework', capabilities: null },
  { company_id: 'c1', custom_label: null, capabilities: { code: 'electrical', label: 'Electrical' } },
  { company_id: 'c2', custom_label: null, capabilities: { code: 'electrical', label: 'Electrical' } },
  { company_id: 'c3', custom_label: 'Ice roads', capabilities: null },
  { company_id: 'c4', custom_label: null, capabilities: null },
]

test('each company’s capabilities: catalog entries first, then its own words, each by label; an empty row is nothing', () => {
  const held = heldByCompany(rows)
  assert.deepEqual(held.get('c1')!.map((h) => h.label), ['Electrical', 'Welding and fabrication', 'Stonework'])
  assert.deepEqual(held.get('c3'), [{ code: null, label: 'Ice roads' }])
  assert.equal(held.has('c4'), false)
})

test('the filter offers only catalog capabilities some company holds, with counts, and never a company’s own words', () => {
  assert.deepEqual(filterOptions(heldByCompany(rows)), [{ code: 'electrical', label: 'Electrical', count: 2 }, { code: 'welding', label: 'Welding and fabrication', count: 1 }])
})

test('filtering keeps the companies that hold the capability, none held keeps none, and no code keeps all', () => {
  const held = heldByCompany(rows)
  const links = ['c1', 'c2', 'c3', 'c4'].map((company_id) => ({ company_id }))
  assert.deepEqual(holding(links, held, 'electrical').map((l) => l.company_id), ['c1', 'c2'])
  assert.deepEqual(holding(links, held, 'welding').map((l) => l.company_id), ['c1'])
  assert.deepEqual(holding(links, held, 'unknown'), [])
  assert.equal(holding(links, held, null).length, 4)
  assert.equal(holding(links, held, '').length, 4)
})
