'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { changeWorkspace } from './actions'
import styles from './AdminOverview.module.css'

const number = new Intl.NumberFormat('hr-HR')
const dateTime = new Intl.DateTimeFormat('hr-HR', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zagreb',
})
const roles = { user: 'Korisnik', editor: 'Urednik', admin: 'Administrator' }
const changeableRoles = { user: roles.user, editor: roles.editor }
const plans = { free: 'Besplatni', starter: 'Standard', standard: 'Standard', pro: 'Pro' }
const issues = {
  missing_key: 'Nedostaje ključ', ambiguous: 'Nejasan zapis', missing_media: 'Nedostaje medij',
  missing_source: 'Nedostaje izvor', rights_pending: 'Prava uporabe čekaju potvrdu',
}
const reviewStates = { review: 'Na pregledu', approved: 'Urednički odobreno', withdrawn: 'Povučeno iz reda' }
const reportStates = { open: 'Otvorena', reviewed: 'Pregledana', resolved: 'Riješena', dismissed: 'Odbačena' }
const reportReasons = { incorrect: 'Netočno pitanje ili odgovor', outdated: 'Zastarjelo', ambiguous: 'Nejasno', other: 'Drugo' }
const learningMode = { exam: 'Ispit', practice: 'Vježba' }
const coverage = {
  published: 'Objavljeno', legacy_available: 'Postojeća izvedba', qa: 'U provjeri', missing: 'Nedostaje',
  unverified: 'Nepotvrđeno', partial: 'Djelomično', soon: 'Najavljeno',
}
const subjectNames = {
  bio: 'Biologija', eng: 'Engleski jezik', eti: 'Etika', fil: 'Filozofija', fiz: 'Fizika', fra: 'Francuski jezik',
  geo: 'Geografija', gla: 'Glazbena umjetnost', grk: 'Grčki jezik', hrv: 'Hrvatski jezik', inf: 'Informatika',
  kem: 'Kemija', lat: 'Latinski jezik', lik: 'Likovna umjetnost', log: 'Logika', mat: 'Matematika',
  nje: 'Njemački jezik', pig: 'Politika i gospodarstvo', pov: 'Povijest', psi: 'Psihologija',
  soc: 'Sociologija', spn: 'Španjolski jezik', tal: 'Talijanski jezik', vje: 'Vjeronauk',
}
const operationalKinds = {
  document_load: 'Učitavanje dokumenta', client_error: 'Pogreška u pregledniku',
  media_error: 'Pogreška medija', submission_error: 'Pogreška predaje',
}
const paymentStates = {
  active: 'Aktivna', trialing: 'Probno razdoblje', inactive: 'Neaktivna', canceled: 'Otkazana',
  past_due: 'Kasni uplata', unpaid: 'Neplaćena', incomplete: 'Nedovršena',
}
const panelNames = {
  users: 'Korisnici i ovlasti', content: 'Urednički red', learning: 'Zabilježena aktivnost',
  billing: 'Pretplate i webhookovi', admissions: 'Upisni uvozi i kalendar 2027.',
  health: 'Status aplikacije', audit: 'Audit', attention: 'Traži pažnju',
}
const auditActions = {
  'panel.read': 'Otvaranje prikaza', 'role.set': 'Promjena uloge',
  'content.review': 'Urednička odluka', 'calendar.draft': 'Spremanje nacrta',
  'calendar.publish': 'Objava izmjene termina', 'calendar.withdraw': 'Povlačenje izmjene termina',
  'question.resolve': 'Obrada prijave pitanja',
  'threshold.insert': 'Unos upisnog praga', 'threshold.update': 'Izmjena upisnog praga',
  'threshold.delete': 'Brisanje upisnog praga',
}

function displayDate(value) {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? dateTime.format(date) : '—'
}

function label(map, key) {
  return Object.hasOwn(map, key) ? map[key] : key || '—'
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? number.format(value) : 'Nedostupno'
}

function href(panel, params = {}) {
  const search = new URLSearchParams(panel === 'attention' ? {} : { tab: panel })
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, String(value))
  }
  return search.size ? `/admin?${search}` : '/admin'
}

function MetricSet({ items }) {
  return (
    <dl className={styles.metrics}>
      {items.map(([name, value]) => (
        <div className={styles.stat} key={name}><dt>{name}</dt><dd>{count(value)}</dd></div>
      ))}
    </dl>
  )
}

function Table({ title, columns, rows, empty }) {
  if (!rows.length) return <p className={styles.empty}>{empty}</p>
  return (
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={title}>
      <table className={styles.table}>
        <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {rows.map(([key, ...cells]) => (
            <tr key={key}>{cells.map((cell, index) => <td key={columns[index]}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Filters({ panel, filters, subjects, period, search, mode }) {
  return (
    <form className={styles.filters} action="/admin" method="get">
      <input type="hidden" name="tab" value={panel} />
      {search && <label>Adresa e-pošte ili ID<input type="search" name="q" defaultValue={filters.q} maxLength={128} /></label>}
      {period && (
        <label>Razdoblje<select name="days" defaultValue={filters.days}>
          {[7, 30, 90].map(days => <option key={days} value={days}>Zadnjih {days} dana</option>)}
        </select></label>
      )}
      {!!subjects?.length && (
        <label>Predmet<select name="subject" defaultValue={filters.subject}>
          <option value="">Svi predmeti</option>
          {subjects.map(({ id }) => <option key={id} value={id}>{label(subjectNames, id)}</option>)}
        </select></label>
      )}
      {mode && (
        <label>Način<select name="mode" defaultValue={filters.mode}>
          <option value="">Svi načini</option>
          {Object.entries(learningMode).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select></label>
      )}
      <button type="submit">Primijeni</button>
    </form>
  )
}

function Pagination({ panel, filters, hasNext }) {
  const { page, ...query } = filters
  if (!page && !hasNext) return null
  return (
    <nav aria-label="Stranice rezultata" className={styles.pagination}>
      {page > 0 && <Link prefetch={false} href={href(panel, { ...query, page: page - 1 })}>Prethodna</Link>}
      <span>Stranica {page + 1}</span>
      {hasNext && page < 10000 && <Link prefetch={false} href={href(panel, { ...query, page: page + 1 })}>Sljedeća</Link>}
    </nav>
  )
}

function ActionForm({ operation, fields, submit, children }) {
  const [result, run, pending] = useActionState(changeWorkspace.bind(null, operation), null)
  return (
    <form className={styles.actionForm} action={run} aria-busy={pending}>
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {children}
      <label>Razlog<input name="reason" required maxLength={300} /></label>
      <button type="submit" disabled={pending}>{pending ? 'Spremanje…' : submit}</button>
      {result?.error && <p role="alert" className={styles.feedback}>{result.error}</p>}
      {result?.success && <p role="status" className={styles.feedback}>Promjena je spremljena.</p>}
    </form>
  )
}

function Choice({ name, value, options }) {
  return (
    <select name={name} defaultValue={value} required>
      {Object.entries(options).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
    </select>
  )
}

function Users({ data, filters, actorId, hasNext }) {
  return (
    <>
      <Filters panel="users" filters={filters} search />
      {!data.canManageRoles && <p>Za promjenu uloga potrebna je zasebna ovlast.</p>}
      <p>Administratorske uloge dodjeljuju se kontroliranim izvanrednim postupkom.</p>
      <Table title="Računi i uloge" columns={['Račun', 'Kreiran', 'Status računa', 'Uloga', 'Zapis pretplate', 'Radnja']}
        empty="Nema računa koji odgovaraju ovom pregledu."
        rows={data.rows.map(row => [
          row.id, <>{row.email || 'Bez e-pošte'}<small>{row.id}</small></>,
          displayDate(row.created_at), row.blocked ? 'Blokiran' : row.confirmed_at ? 'Potvrđen' : 'Nepotvrđen',
          label(roles, row.role),
          row.plan ? <>{label(plans, row.plan)} · {label(paymentStates, row.payment_status)}<small>Razdoblje do {displayDate(row.current_period_end)}</small></> : 'Bez zapisa',
          data.canManageRoles && row.id !== actorId && Object.hasOwn(changeableRoles, row.role) && (
            <details>
              <summary>Promijeni ulogu</summary>
              <ActionForm operation="role.set" fields={{ id: row.id, expected: row.role }} submit="Spremi ulogu">
                <label>Nova uloga <Choice name="role" options={changeableRoles} value={row.role} /></label>
              </ActionForm>
            </details>
          ),
        ])} />
      <Pagination panel="users" filters={{ q: filters.q, page: filters.page }} hasNext={hasNext} />
    </>
  )
}

function ReviewForm({ item, defaultSubject, subjects }) {
  const fields = item ? {
    subject: item.subject_id, kind: item.artifact_kind, key: item.artifact_key, revision: item.revision,
    expected: item.state, expectedVersion: item.version,
  } : { expected: '', expectedVersion: 0 }
  return (
    <ActionForm operation="content.review" fields={fields} submit="Spremi uredničku odluku">
      {!item && (
        <>
          <label>Predmet <Choice name="subject" value={defaultSubject || subjects[0]?.id}
            options={Object.fromEntries(subjects.map(({ id }) => [id, label(subjectNames, id)]))} /></label>
          <label>Vrsta zapisa <Choice name="kind" options={{ exam: 'Ispit', chapter: 'Poglavlje' }} value="exam" /></label>
          <label>Ključ zapisa<input name="key" required maxLength={100} /></label>
          <label>Revizija<input name="revision" required maxLength={130} /></label>
        </>
      )}
      <label>Izvor (HTTPS)<input name="source" type="url" required maxLength={508} defaultValue={item?.source_url} /></label>
      <label>Odluka <Choice name="state" options={reviewStates} value={item?.state ?? 'review'} /></label>
      <fieldset className={styles.checks}>
        <legend>Otvorene prepreke</legend>
        {Object.entries(issues).map(([code, name]) => (
          <label key={code}><input type="checkbox" name="issues" value={code} defaultChecked={item?.issues?.includes(code)} />{name}</label>
        ))}
      </fieldset>
    </ActionForm>
  )
}

function Content({ data, subjects, filters, hasNext }) {
  const visible = subjects.filter(({ id }) => !filters.subject || filters.subject === id)
  return (
    <>
      <p>Uredničko odobrenje evidentira odluku. Sadržaj se objavljuje kroz proces izdanja.</p>
      <Filters panel="content" filters={filters} subjects={subjects} />
      <section className={styles.panel}>
        <h3>Pokrivenost predmeta</h3>
        <Table title="Pokrivenost predmeta" columns={['Predmet', 'Razina', 'Lekcije s izvorom / identificirane', 'Objavljene lekcije', 'Ispiti', 'Vježba', 'Katalog']}
          empty="Nema inventara za taj predmet."
          rows={visible.map(({ id, levels, capabilities, catalogue }) => [
            id, label(subjectNames, id), levels?.join(', ').replace('single', 'Jedna razina') || '—',
            `${count(capabilities?.lessons?.sourceAvailable)} / ${count(capabilities?.lessons?.identified)}`,
            count(capabilities?.lessons?.published), label(coverage, capabilities?.exams?.status),
            label(coverage, capabilities?.practice?.status), label(coverage, catalogue?.status),
          ])} />
      </section>
      <details className={styles.panel}>
        <summary>Dodaj urednički zapis</summary>
        <ReviewForm subjects={subjects} defaultSubject={filters.subject} />
      </details>
      <section className={styles.panel}>
        <h3>Odluke</h3>
        {data.reviews.length ? (
          <ul className={styles.entries}>{data.reviews.map(item => {
            const key = `${item.subject_id}/${item.artifact_kind}/${item.artifact_key}/${item.revision}`
            return (
              <li key={key}>
                <h4>{label(subjectNames, item.subject_id)} · {item.artifact_kind === 'exam' ? 'Ispit' : 'Poglavlje'} · {item.artifact_key}</h4>
                <p>Revizija {item.revision} · {label(reviewStates, item.state)} · {displayDate(item.updated_at)}</p>
                {!!item.issues?.length && <p>{item.issues.map(issue => label(issues, issue)).join(', ')}</p>}
                <details>
                  <summary>Uredi odluku i izvor</summary>
                  <ReviewForm key={item.version} item={item} />
                </details>
              </li>
            )
          })}</ul>
        ) : <p className={styles.empty}>Nema uredničkih zapisa za ovaj pregled.</p>}
        <Pagination panel="content" filters={{ subject: filters.subject, page: filters.page }} hasNext={hasNext} />
      </section>
    </>
  )
}

function Learning({ data, filters, subjects }) {
  return (
    <>
      <Filters panel="learning" filters={filters} subjects={subjects} period mode />
      <p>Odabrano razdoblje vrijedi za sve brojke. Predmet i način sužavaju tablicu spremljenih predaja.</p>
      <MetricSet items={[
        ['Računi sa zabilježenim posjetom', data.activeAccounts], ['Zabilježeni posjeti', data.visits],
        ['Ažurirani zapisi o poglavljima', data.chapterRecordsUpdated], ['Izrađeni planovi učenja', data.plans],
      ]} />
      <Table title="Spremljene predaje" columns={['Predmet', 'Način', 'Predaje']} empty="U ovom pregledu nema spremljenih predaja."
        rows={data.attempts.map(row => [`${row.subject_id}-${row.mode}`, label(subjectNames, row.subject_id), label(learningMode, row.mode), count(row.count)])} />
    </>
  )
}

function Billing({ data, filters }) {
  return (
    <>
      <Filters panel="billing" filters={filters} period />
      <MetricSet items={[
        ['Računi s aktivnom pretplatom ili probnim razdobljem', data.active],
        ['Računi kojima razdoblje završava u sljedećih 7 dana', data.expiring],
        ['Zapisi pretplate označeni neaktivno ili otkazano u razdoblju', data.inactive],
      ]} />
      <h3>Webhookovi za provjeru</h3>
      <p>Do 40 zadnjih neuspjelih događaja ili obrada kojima je istekao rok.</p>
      <Table title="Webhookovi za provjeru" columns={['Događaj', 'Obrada', 'Pokušaji', 'Zadnja promjena']}
        empty="U ovom razdoblju nema webhookova za provjeru."
        rows={data.attention.map((row, index) => [`${row.updated_at}-${index}`, row.event_type, row.status === 'failed' ? 'Neuspjelo' : 'Istekao rok obrade', count(row.attempt_count), displayDate(row.updated_at)])} />
    </>
  )
}

function minuteClock(minute) {
  return [Math.floor(minute / 60), minute % 60].map(part => String(part).padStart(2, '0')).join(':')
}

function localDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('.') + '.' : '—'
}

function CalendarEvent({ event, calendar, draft, released }) {
  const version = draft?.version ?? 0
  const fields = { id: event.id, version }
  const source = calendar.sources[event.sourceId]
  return (
    <section className={styles.panel} aria-label={event.title}>
      <h4>{event.title}</h4>
      <p>Službena osnova · {localDate(event.localDate)} · {event.startsAtLocal} · {event.segmentMinutes.join(' + ')} min</p>
      <a href={source}>Izvorni vremenik NCVVO-a</a>
      {released && <p>Objavljena izmjena · {localDate(released.scheduled_date)} · {minuteClock(released.start_minute)} · {released.segments.join(' + ')} min</p>}
      <ActionForm key={version} operation="calendar.draft" fields={fields} submit="Spremi nacrt">
        <label>Datum<input type="date" name="date" required min="2027-01-01" max="2027-12-31" defaultValue={draft?.scheduled_date ?? event.localDate} /></label>
        <label>Početak<input type="time" name="startsAt" required defaultValue={draft ? minuteClock(draft.start_minute) : event.startsAtLocal} /></label>
        <label>Dijelovi trajanja u minutama<input name="segments" required maxLength={32} defaultValue={(draft?.segments ?? event.segmentMinutes).join(' + ')} /></label>
        <label>Izvor NCVVO-a<input type="url" name="source" required maxLength={508} defaultValue={draft?.source_url ?? source} /></label>
      </ActionForm>
      {draft && draft.version !== released?.version && (
        <details className={styles.entries}>
          <summary>Objavi nacrt</summary>
          <p>Objavit će se spremljena revizija {draft.version} termina.</p>
          <ActionForm operation="calendar.publish" fields={fields} submit="Objavi izmjenu" />
        </details>
      )}
      {released && (
        <details className={styles.entries}>
          <summary>Povuci objavljenu izmjenu</summary>
          <p>Povlačenjem izmjene ponovno vrijedi službeni termin iz osnovnog kalendara.</p>
          <ActionForm operation="calendar.withdraw" fields={fields} submit="Povuci izmjenu" />
        </details>
      )}
    </section>
  )
}

function Calendar({ data, filters, calendar }) {
  const events = calendar.events.filter(event => event.session === filters.session)
  const draftById = new Map(data.drafts.map(draft => [draft.event_id, draft]))
  const releaseById = new Map(data.released.map(released => [released.event_id, released]))
  const current = events.find(event => event.id === filters.event)
  return (
    <section className={styles.panel}>
      <h3>Kalendar mature {calendar.schoolYear}</h3>
      <p>Uredi postojeći službeni ispitni termin. Nacrt postaje vidljiv nakon objave.</p>
      <nav aria-label="Rokovi mature" className={styles.pagination}>
        {['prvi', 'drugi'].map(session => (
          <Link key={session} prefetch={false} href={href('admissions', { session })}
            aria-current={filters.session === session ? 'page' : undefined}>
            {session === 'prvi' ? 'Prvi rok' : 'Drugi rok'}
          </Link>
        ))}
      </nav>
      <form method="get" action="/admin" className={styles.filters} aria-label="Odaberi ispitni termin">
        <input type="hidden" name="tab" value="admissions" />
        <input type="hidden" name="session" value={filters.session} />
        <label>Ispitni termin<select name="event" defaultValue={current?.id || ''} required>
          <option value="" disabled>Odaberi ispit</option>
          {events.map(event => <option key={event.id} value={event.id}>{event.title} · {localDate(event.localDate)}</option>)}
        </select></label>
        <button type="submit">Otvori termin</button>
      </form>
      {current && <CalendarEvent event={current} calendar={calendar}
        draft={draftById.get(current.id)} released={releaseById.get(current.id)} />}
      <Table title="Termini u roku" columns={['Ispit', 'Službeni termin', 'Uredničko stanje']}
        empty="Za ovaj rok nema ispitnih termina."
        rows={events.map(event => {
          const draft = draftById.get(event.id)
          const released = releaseById.get(event.id)
          const state = draft && draft.version !== released?.version
            ? released ? 'Objavljeno · novi nacrt' : 'Nacrt'
            : released ? 'Objavljena izmjena' : 'Službena osnova'
          return [
            event.id, <Link prefetch={false} href={href('admissions', { session: filters.session, event: event.id })}
              aria-current={current?.id === event.id ? 'true' : undefined}>{event.title}</Link>,
            `${localDate(event.localDate)} · ${event.startsAtLocal}`, state,
          ]
        })} />
    </section>
  )
}

function Admissions({ data, filters, calendar }) {
  const importStates = { running: 'U tijeku', success: 'Uspio', partial: 'Djelomičan', failed: 'Neuspješan' }
  return (
    <>
      <MetricSet items={[[ 'Upisni pragovi za provjeru', data.pendingThresholds ]]} />
      <section className={styles.panel}>
        <h3>Posljednji upisni uvozi</h3>
        <p><Link prefetch={false} href="/admin/prijemni">Otvori uvoz i obradu podataka</Link></p>
        <Table title="Posljednji upisni uvozi" columns={['Izvor', 'Status', 'Redci', 'Promijenjeni', 'Početak', 'Završetak']}
          empty="Nema zabilježenih upisnih uvoza."
          rows={data.imports.map((row, index) => [
            `${row.started_at}-${index}`, row.source, label(importStates, row.status), count(row.rows_total),
            count(row.rows_changed), displayDate(row.started_at), displayDate(row.finished_at),
          ])} />
      </section>
      <Calendar data={data} filters={filters} calendar={calendar} />
    </>
  )
}

function Health({ data, filters }) {
  return (
    <>
      <Filters panel="health" filters={filters} period />
      <p>Prikaz obuhvaća samo zabilježene uzorke prijavljenih računa. P95 učitavanja odnosi se na učitavanje dokumenta.</p>
      <Table title="Mjerenja i pogreške" columns={['Odjeljak', 'Vrsta', 'Uzorci', 'P95', 'Zadnji zapis']}
        empty="Nema mjerenja u ovom razdoblju."
        rows={data.measurements.map(row => [
          `${row.route}-${row.kind}`, row.route, label(operationalKinds, row.kind),
          count(row.count), row.kind === 'document_load' && Number.isSafeInteger(row.p95_ms) ? `${count(row.p95_ms)} ms` : '—',
          displayDate(row.latest),
        ])} />
      <section className={styles.panel}>
        <h3>Prijave pitanja u igri</h3>
        <p>Do 40 zadnjih otvorenih ili pregledanih prijava, neovisno o razdoblju mjerenja.</p>
        <Table title="Prijave pitanja" columns={['Pitanje', 'Oznaka razloga', 'Status', 'Zaprimljena', 'Radnja']}
          empty="Trenutačno nema prijava za obradu."
          rows={data.reports.map(row => [
            row.id, row.question_id, label(reportReasons, row.reason), label(reportStates, row.status), displayDate(row.created_at),
            <details>
              <summary>Obradi prijavu</summary>
              <ActionForm operation="question.resolve" fields={{ id: row.id, expected: row.status }} submit="Spremi odluku">
                <label>Status <Choice name="state" value=""
                  options={{ '': 'Odaberi status', ...Object.fromEntries(Object.entries(reportStates).filter(([id]) => id !== 'open' && id !== row.status)) }} /></label>
              </ActionForm>
            </details>,
          ])} />
      </section>
    </>
  )
}

function Audit({ data, filters, hasNext }) {
  return (
    <>
      <Filters panel="audit" filters={filters} period />
      <Table title="Dnevnik radnji" columns={['Vrijeme', 'Radnja', 'Operater', 'Zapis', 'Prije', 'Poslije', 'Razlog']}
        empty="Nema audit zapisa u ovom pregledu."
        rows={data.rows.map((row, index) => [
          `${row.occurred_at}-${index}`, displayDate(row.occurred_at), label(auditActions, row.action), row.actor_id || '—',
          row.target, label(reviewStates, row.before_value), label(reviewStates, row.after_value), row.reason || '—',
        ])} />
      <Pagination panel="audit" filters={{ days: filters.days, page: filters.page }} hasNext={hasNext} />
    </>
  )
}

function Attention({ data, filters }) {
  const items = [
    ['Uredničke stavke na pregledu', data.contentReviews, 'content'],
    ['Prijave pitanja za obradu', data.questionReports, 'health'],
    ['Upisni pragovi za provjeru', data.thresholds, 'admissions'],
    ['Webhookovi za provjeru', data.webhookIssues, 'billing'],
    ['Zabilježene pogreške', data.clientErrors, 'health'],
  ]
  return (
    <>
      <p>Webhookovi i pogreške obuhvaćaju zadnjih {filters.days} dana. Prikazane su samo zabilježene stavke.</p>
      <ul className={styles.attention}>
        {items.map(([name, value, panel]) => (
          <li key={name}><Link prefetch={false} href={href(panel, { days: filters.days })}>{name}</Link><strong>{count(value)}</strong></li>
        ))}
      </ul>
    </>
  )
}

const panels = { users: Users, content: Content, learning: Learning, billing: Billing, admissions: Admissions, health: Health, audit: Audit, attention: Attention }

export default function Workspace({ panel, data, filters, subjects, actorId, calendar, hasNext }) {
  const Panel = panels[panel]
  return (
    <section className={styles.workspace} aria-labelledby="workspace-heading">
      <h2 id="workspace-heading">{panelNames[panel]}</h2>
      {data ? (
        <Panel {...{ data, filters, subjects, actorId, calendar, hasNext }} />
      ) : (
        <div className={styles.panel} role="status">
          <p>Podaci za ovaj prikaz trenutačno nisu dostupni.</p>
          <a href={href(panel, filters)}>Pokušaj ponovno</a>
        </div>
      )}
    </section>
  )
}
