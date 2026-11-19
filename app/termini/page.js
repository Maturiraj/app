import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import calendar from '@/content/termini/matura-2027.json'
import Termini2026 from './Termini2026'

export const dynamic = 'force-dynamic'

const formatter = new Intl.DateTimeFormat('hr-HR', {
  timeZone: calendar.timeZone, day: 'numeric', month: 'long', year: 'numeric',
})

function dateLabel(isoDate) {
  return formatter.format(new Date(`${isoDate}T12:00:00Z`))
}

function timeLabel(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

function officialSource(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.origin === 'https://www.ncvvo.hr' && !url.username && !url.password) return url.href
  } catch {
    // A malformed address cannot identify a published correction.
  }
  return null
}

function applyCorrection(event, correction) {
  const { scheduled_date: date, start_minute: start, segments, source_url } = correction
  const source = officialSource(source_url)
  if (!source || typeof date !== 'string' || !/^2027-\d{2}-\d{2}$/.test(date)) return null
  const day = new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null
  if (!Number.isInteger(start) || start < 0 || start >= 1440) return null
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 4 ||
      !segments.every(minutes => Number.isInteger(minutes) && minutes >= 1 && minutes <= 360)) return null
  const duration = segments.reduce((total, minutes) => total + minutes, 0)
  if (start + duration >= 1440) return null
  return {
    ...event, localDate: date, startsAtLocal: timeLabel(start), endsAtLocal: timeLabel(start + duration),
    segmentMinutes: segments, durationMinutes: duration, correctionSource: source,
  }
}

async function publishedEvents() {
  let data
  try {
    const supabase = await createClient()
    const response = await supabase.rpc('matura_published_calendar').abortSignal(AbortSignal.timeout(5000))
    if (!response.error && Array.isArray(response.data)) data = response.data
  } catch {
    // Keep the official baseline available when the public RPC cannot be reached.
  }
  const byId = new Map(calendar.events.map(event => [event.id, event]))
  let incomplete = false
  for (const correction of data ?? []) {
    const event = byId.get(correction?.event_id)
    const updated = event && applyCorrection(event, correction)
    if (updated) byId.set(event.id, updated)
    else incomplete = true
  }
  const events = [...byId.values()].sort((a, b) =>
    a.localDate.localeCompare(b.localDate) || a.startsAtLocal.localeCompare(b.startsAtLocal))
  return { events, unavailable: !data, incomplete }
}

export default async function Termini({ searchParams }) {
  const params = await searchParams
  if (params?.godina === '2026') return <Termini2026 />

  const { events, unavailable, incomplete } = await publishedEvents()

  return (
    <main style={{ maxWidth: '68rem', margin: 'auto', padding: '2rem 1rem' }}>
      <h1>Termini državne mature 2027.</h1>
      <p>Vremena početka i završetka navedena su po lokalnom vremenu u Hrvatskoj.</p>
      {unavailable && <p role="status">Prikazan je službeni raspored provjeren {dateLabel(calendar.checkedOn)} Naknadne objavljene izmjene trenutačno se ne mogu dohvatiti.</p>}
      {incomplete && <p role="status">Dio objavljenih izmjena nije bilo moguće povezati s terminima. Provjerite službeni raspored odabranog roka.</p>}
      {Object.entries(calendar.sessions).map(([session, dates]) => (
        <section key={session} style={{ marginBlockStart: '2rem' }} aria-labelledby={session}>
          <h2 id={session}>{session === 'prvi' ? 'Prvi rok' : 'Drugi rok'}</h2>
          <p><a href={officialSource(calendar.sources[session])}>Službeni vremenik NCVVO-a za {session} rok (PDF)</a></p>
          <ul style={{ paddingInlineStart: '1.25rem' }}>
            <li>Prijave {dateLabel(dates.registration[0])} – {dateLabel(dates.registration[1])}</li>
            <li>Privremeni rezultati {dateLabel(dates.preliminaryResults)}</li>
            <li>Prigovori do {dateLabel(dates.objectionDeadline)}</li>
            <li>Konačni rezultati {dateLabel(dates.finalResults)}</li>
            <li>Podjela svjedodžbi i potvrda {dateLabel(dates.certificateDistribution)}</li>
          </ul>
          <ul aria-label={`Ispiti za ${session} rok`} style={{ listStyle: 'none', padding: 0 }}>
            {events.filter(event => event.session === session).map(event => (
              <li key={event.id} style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.4rem 1rem',
                borderBottom: '1px solid var(--border, #bbb)', padding: '0.75rem 0',
              }}>
                <strong style={{ flex: '1 1 18rem' }}>{event.title}</strong>
                <time dateTime={event.localDate}>{dateLabel(event.localDate)}</time>
                <span>{event.startsAtLocal}–{event.endsAtLocal}</span>
                <span>{event.segmentMinutes.join(' + ')} min</span>
                {event.correctionSource && <a href={event.correctionSource}>Objavljeni ispravak</a>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p><Link href="/termini?godina=2026">Arhiva termina za 2026.</Link></p>
    </main>
  )
}
