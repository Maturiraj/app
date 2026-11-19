import 'server-only'

import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminLoading from './loading'
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

async function OverviewMetrics({ supabase }) {
  const { data, error } = await supabase.rpc('admin_overview_metrics')
  if (error?.code === '42501') notFound()

  if (error || !data || !Array.isArray(data.visitsBySection)) {
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

export default async function AdminOverview() {
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

  return (
    <main className={styles.overview}>
      <h1>Administrator</h1>
      <nav className={styles.tools} aria-label="Administratorski alati">
        {tools.map(({ href, name }) => <Link key={href} href={href}>{name}</Link>)}
      </nav>
      <Suspense fallback={<AdminLoading />}>
        <OverviewMetrics supabase={supabase} />
      </Suspense>
    </main>
  )
}
