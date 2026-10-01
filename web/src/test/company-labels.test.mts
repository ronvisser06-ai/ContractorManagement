/**
 * F1 Step 2 — pure helpers behind the org "Add company" flow:
 * RPC error codes → user-facing text, link status labels, admin types.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ADMIN_TYPES,
  ADMIN_TYPE_LABEL,
  companyErrorMessage,
  isAdminType,
  isPossibleDuplicate,
  linkStatusLabel,
} from '../lib/companies/labels.ts'

describe('companyErrorMessage', () => {
  it('maps every F1 RPC error code to friendly text (never the raw code)', () => {
    for (const code of [
      'not_client_admin', 'name_required', 'admin_email_required', 'admin_type_required',
      'duplicate_business_number', 'possible_duplicate', 'company_not_found', 'already_linked',
      'not_creator', 'company_has_admin',
    ]) {
      const msg = companyErrorMessage(code)
      assert.ok(msg.length > 10 && !msg.includes(code), `${code} → ${msg}`)
    }
  })

  it('finds the code inside a Postgres error message', () => {
    assert.match(companyErrorMessage('ERROR: possible_duplicate (P0001)'), /already on the platform/)
  })

  it('falls back to a generic message for unknown errors', () => {
    assert.equal(companyErrorMessage('connection reset'), 'Something went wrong. Please try again.')
    assert.equal(companyErrorMessage(undefined), 'Something went wrong. Please try again.')
  })

  it('duplicate-business-number points the user to search instead of creating', () => {
    assert.match(companyErrorMessage('duplicate_business_number'), /search for it and request a link/)
  })
})

describe('isPossibleDuplicate', () => {
  it('is true only for the possible_duplicate code', () => {
    assert.equal(isPossibleDuplicate('possible_duplicate'), true)
    assert.equal(isPossibleDuplicate('duplicate_business_number'), false)
    assert.equal(isPossibleDuplicate(null), false)
  })
})

describe('linkStatusLabel', () => {
  it('distinguishes "awaiting our nominated admin" from "waiting on the company"', () => {
    assert.equal(linkStatusLabel('invited', true), 'Awaiting admin')
    assert.equal(linkStatusLabel('invited', false), 'Requested')
  })
  it('labels the other statuses', () => {
    assert.equal(linkStatusLabel('active', false), 'Linked')
    assert.equal(linkStatusLabel('declined', false), 'Declined')
    assert.equal(linkStatusLabel('suspended', true), 'Suspended')
  })
})

describe('admin types', () => {
  it('offers exactly the three confirmed types (F1-4), each labelled', () => {
    assert.deepEqual(ADMIN_TYPES.map((t) => t.value), ['company_staff', 'client_staff', 'third_party'])
    for (const t of ADMIN_TYPES) assert.equal(ADMIN_TYPE_LABEL[t.value], t.label)
  })
  it('isAdminType accepts only those values', () => {
    assert.equal(isAdminType('third_party'), true)
    assert.equal(isAdminType('contractor_admin'), false)
    assert.equal(isAdminType(undefined), false)
  })
})
