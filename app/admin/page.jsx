import 'server-only'

import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import inventory from '@/content/learning/subject-inventory.json'
import calendar from '@/content/termini/matura-2027.json'
import AdminLoading from './loading'
import Workspace from './Workspace'
import styles from './AdminOverview.module.css'

const labels = {
  'ai-profesor': 'AI profesor',
  checklist: 'Checklist',
  discere: 'Discere',
  formule: 'Formule',
  kalkulator: 'Kalkulator',
  'plan-ucenja': 'Plan učenja',
  prijemni: 'Prijemni',
  skripte: 'Skripte',
  other: 'Ostali zabilježeni odjeljci',
}

const tools = [
  { href: '/admin/prijemni', name: 'Uvoz podataka o studijima' },
  { href: '/admin-pragovi', name: 'Uređivanje upisnih pragova' },
  { href: '/admin/ab', name: 'A/B eksperimenti' },
]

const tabs = [
  ['overview', 'Pregled'],
  ['users', 'Korisnici'],
  ['content', 'Sadržaj'],
  ['learning', 'Aktivnost'],
  ['billing', 'Pretplate'],
  ['admissions', 'Upisi i kalendar'],
  ['health', 'Status aplikacije'],
  ['audit', 'Audit'],
]

const subjectIds = new Set(inventory.subjects.map(({ id }) => id))
const calendarIds = new Set(calendar.events.map(({ id }) => id))

function readFilters(params) {
  const value = name => typeof params?.[name] === 'string' ? params[name] : ''
  const days = Number(value('days'))
  const page = /^\d{1,5}$/.test(value('page')) ? Math.min(Number(value('page')), 10000) : 0
  const subject = value('subject')
  const mode = value('mode')
  const event = value('event')
  return {
    days: [7, 30, 90].includes(days) ? days : 30,
    page,
    q: value('q').trim().slice(0, 128),
    subject: subjectIds.has(subject) ? subject : '',
    mode: ['exam', 'practice'].includes(mode) ? mode : '',
    session: value('session') === 'drugi' ? 'drugi' : 'prvi',
    event: calendarIds.has(event) ? event : '',
  }
}

const number = new Intl.NumberFormat('hr-HR')
const dateTime = new Intl.DateTimeFormat('hr-HR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Zagreb',
})

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{Number.isSafeInteger(value) && value >= 0 ? number.format(value) : 'Nedostupno'}</dd>
    </div>
  )
}

function collectionTime(value) {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? dateTime.format(date) : null
}

async function readPanel(supabase, name, args) {
  let result
  try {
    result = await supabase.rpc(name, args)
  } catch {
    return null
  }
  if (result.error?.code === '42501') notFound()
  return result.error ? null : result.data
}

async function OverviewMetrics({ supabase }) {
  const data = await readPanel(supabase, 'admin_overview_metrics')
  if (!data || !Array.isArray(data.visitsBySection)) {
    return (
      <section className={styles.panel} aria-labelledby="metrics-unavailable">
        <h2 id="metrics-unavailable">Podaci trenutačno nisu dostupni</h2>
        <p>Pokušaj ponovno otvoriti pregled.</p>
        <a href="/admin">Osvježi pregled</a>
      </section>
    )
  }

  const collectedAt = collectionTime(data.collectedAt)
  return (
    <>
      <section aria-labelledby="accounts-heading">
        <h2 id="accounts-heading">Računi</h2>
        {collectedAt && <p>Stanje na <time dateTime={data.collectedAt}>{collectedAt}</time></p>}
        <dl className={styles.metrics}>
          <Stat label="Registrirani računi" value={data.registeredAccounts} />
          <Stat label="Novi računi u zadnjih 30 dana" value={data.newAccounts} />
          <Stat label="Računi sa zabilježenim posjetom u zadnjih 30 dana" value={data.activeAccounts} />
        </dl>
      </section>
      <section aria-labelledby="activity-heading">
        <h2 id="activity-heading">Zabilježena aktivnost u zadnjih 30 dana</h2>
        <p>Pregled obuhvaća praćene posjete prijavljenih računa i spremljene radnje. Za ostale događaje pokrivenost još nije dostupna.</p>
        <dl className={styles.metrics}>
          <Stat label="Zabilježeni posjeti" value={data.recordedVisits} />
          <Stat label="Spremljene predaje ispita" value={data.savedExams} />
          <Stat label="Spremljene predaje vježbi" value={data.savedPractice} />
          <Stat label="Izrađeni planovi učenja" value={data.newStudyPlans} />
        </dl>
        <div className={styles.panel}>
          <h3>Posjeti po odjeljcima</h3>
          {data.visitsBySection.length === 0 ? <p>U ovom razdoblju nema zabilježenih posjeta.</p> : (
            <dl className={styles.sections}>
              {data.visitsBySection.map(({ section, visits }) => (
                <Stat key={section} label={labels[section] || labels.other} value={visits} />
              ))}
            </dl>
          )}
        </div>
      </section>
    </>
  )
}

const panelArrays = {
  users: ['rows'], content: ['reviews'], learning: ['attempts'], billing: ['attention'],
  admissions: ['drafts', 'released', 'imports'], health: ['measurements', 'reports'], audit: ['rows'],
}
const paged = { users: 'rows', content: 'reviews', audit: 'rows' }

async function WorkspacePanel({ supabase, panel, filters, actorId }) {
  const data = await readPanel(supabase, 'admin_workspace_read', {
    panel,
    search_term: panel === 'users' ? filters.q : '',
    period_days: filters.days,
    page_number: filters.page,
    subject_filter: ['content', 'learning'].includes(panel) ? filters.subject : '',
    mode_filter: panel === 'learning' ? filters.mode : '',
  })
  const valid = data && typeof data === 'object' && !Array.isArray(data) &&
    (panelArrays[panel] ?? []).every(key => Array.isArray(data[key]))
  const subjects = ['content', 'learning'].includes(panel) ? inventory.subjects : []
  const pageKey = paged[panel]
  const hasNext = Boolean(valid && pageKey && data[pageKey].length > 25)
  const visibleData = valid && pageKey ? { ...data, [pageKey]: data[pageKey].slice(0, 25) } : data
  return (
    <Workspace
      panel={panel}
      data={valid ? visibleData : null}
      hasNext={hasNext}
      filters={filters}
      actorId={panel === 'users' ? actorId : undefined}
      subjects={subjects}
      calendar={panel === 'admissions' ? calendar : undefined}
    />
  )
}

export default async function AdminOverview({ searchParams }) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error?.status >= 500) throw new Error('Administratorska prijava trenutačno nije dostupna.')
  if (!user) redirect('/prijava?redirect=%2Fadmin')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw new Error('Administratorska ovlast trenutačno se ne može provjeriti.')
  if (profile?.role !== 'admin') notFound()

  const params = await searchParams
  const tab = tabs.some(([id]) => id === params?.tab) ? params.tab : 'overview'
  const filters = readFilters(params)

  return (
    <main className={styles.overview}>
      <h1>Administrator</h1>
      <nav className={styles.tabs} aria-label="Administratorski pregled">
        {tabs.map(([id, name]) => (
          <Link key={id} href={id === 'overview' ? '/admin' : `/admin?tab=${id}`}
            prefetch={false} aria-current={tab === id ? 'page' : undefined}>{name}</Link>
        ))}
      </nav>
      <nav className={styles.tools} aria-label="Administratorski alati">
        {tools.map(({ href, name }) => <Link key={href} href={href}>{name}</Link>)}
      </nav>
      {tab === 'overview' ? (
        <>
          <Suspense fallback={<AdminLoading label="Učitavanje stavki za pažnju…" />}>
            <WorkspacePanel supabase={supabase} panel="attention" filters={filters} />
          </Suspense>
          <Suspense fallback={<AdminLoading label="Učitavanje računa i aktivnosti…" />}>
            <OverviewMetrics supabase={supabase} />
          </Suspense>
        </>
      ) : (
        <Suspense key={JSON.stringify([tab, filters])} fallback={<AdminLoading label="Učitavanje odabranog prikaza…" />}>
          <WorkspacePanel supabase={supabase} panel={tab} filters={filters} actorId={user.id} />
        </Suspense>
      )}
    </main>
  )
}
