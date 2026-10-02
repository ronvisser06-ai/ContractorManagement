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
