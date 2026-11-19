'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import inventory from '@/content/learning/subject-inventory.json'
import calendar from '@/content/termini/matura-2027.json'

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const roles = ['user', 'editor']
const reviewStates = ['review', 'approved', 'withdrawn']
const issueCodes = ['missing_key', 'ambiguous', 'missing_media', 'missing_source', 'rights_pending']
const subjectIds = new Set(inventory.subjects.map(({ id }) => id))
const eventIds = new Set(calendar.events.map(({ id }) => id))

function field(form, name) {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function version(value) {
  return /^(?:0|[1-9]\d{0,8})$/.test(value) ? Number(value) : null
}

function httpsUrl(value, official = false) {
  const pattern = official
    ? /^https:\/\/www[.]ncvvo[.]hr\/[^\s?#]{1,470}(#[A-Za-z0-9=._-]{1,30})?$/
    : /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?([/?#][^\s]*)?$/
  if (!pattern.test(value) || value.length > 508) return false
  try {
    const url = new URL(value)
    return !url.username && !url.password && (!official || (
      url.origin === 'https://www.ncvvo.hr'
    ))
  } catch {
    return false
  }
}

function roleInput(form) {
  const id = field(form, 'id')
  const role = field(form, 'role')
  const expected = field(form, 'expected')
  return uuid.test(id) && roles.includes(role) && roles.includes(expected) && role !== expected
    ? { id, role, expected }
    : null
}

function reviewInput(form) {
  const subject = field(form, 'subject')
  const kind = field(form, 'kind')
  const key = field(form, 'key')
  const revision = field(form, 'revision')
  const state = field(form, 'state')
  const source = field(form, 'source')
  const expected = field(form, 'expected')
  const expectedVersion = version(field(form, 'expectedVersion'))
  const issues = [...new Set(form.getAll('issues'))]
  if (!subjectIds.has(subject) || !['exam', 'chapter'].includes(kind) ||
      !/^[a-z0-9_.-]{1,100}$/i.test(key) || !/^[a-z0-9:_.-]{1,130}$/i.test(revision) ||
      !reviewStates.includes(state) || !httpsUrl(source) || expectedVersion === null ||
      (expectedVersion ? !reviewStates.includes(expected) : expected !== '') ||
      issues.some(issue => !issueCodes.includes(issue)) || (state === 'approved' && issues.length)) {
    return null
  }
  return { subject, kind, key, revision, state, source, issues, expected, expectedVersion }
}

function calendarInput(form, isDraft) {
  const id = field(form, 'id')
  const expectedVersion = version(field(form, 'version'))
  if (!eventIds.has(id) || expectedVersion === null) return null
  if (!isDraft) return expectedVersion ? { id, version: expectedVersion } : null

  const date = field(form, 'date')
  const startsAt = field(form, 'startsAt')
  const segmentText = field(form, 'segments')
  const source = field(form, 'source')
  if (!/^2027-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startsAt) ||
      !/^\d{1,3}(?:\s*[,+]\s*\d{1,3}){0,3}$/.test(segmentText) || !httpsUrl(source, true)) return null

  const parsedDate = new Date(date)
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) return null
  const [hours, minutes] = startsAt.split(':').map(Number)
  const minute = hours * 60 + minutes
  const segments = segmentText.split(/[,+]/).map(Number)
  if (segments.some(part => part < 1 || part > 360) ||
      minute + segments.reduce((total, part) => total + part, 0) >= 1440) return null
  return { id, version: expectedVersion, date, minute, segments, source }
}

function reportInput(form) {
  const id = field(form, 'id')
  const expected = field(form, 'expected')
  const state = field(form, 'state')
  return uuid.test(id) && ['open', 'reviewed'].includes(expected) &&
    ['reviewed', 'resolved', 'dismissed'].includes(state) && state !== expected
    ? { id, expected, state }
    : null
}

export async function changeWorkspace(action, _previous, form) {
  const reason = field(form, 'reason')
  if (!reason || reason.length > 300) return { error: 'Upiši razlog promjene do 300 znakova.' }

  let input
  switch (action) {
    case 'role.set': input = roleInput(form); break
    case 'content.review': input = reviewInput(form); break
    case 'calendar.draft': input = calendarInput(form, true); break
    case 'calendar.publish':
    case 'calendar.withdraw': input = calendarInput(form, false); break
    case 'question.resolve': input = reportInput(form); break
    default: return { error: 'Radnja nije dostupna.' }
  }
  if (!input) return { error: 'Provjeri obvezna polja, dopuštene vrijednosti i otvorene prepreke.' }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('admin_workspace_change', { action_name: action, input: { ...input, reason } })
    if (error?.code === '42501') return { error: 'Nemaš ovlast za tu radnju.' }
    if (error?.code === '40001') return { error: 'Zapis se promijenio. Osvježi pregled prije ponovnog spremanja.' }
    if (error) return { error: 'Promjena nije spremljena. Osvježi pregled i pokušaj ponovno.' }
  } catch {
    return { error: 'Promjena trenutačno nije dostupna.' }
  }

  revalidatePath('/admin')
  if (['calendar.publish', 'calendar.withdraw'].includes(action)) revalidatePath('/termini')
  return { success: true }
}
