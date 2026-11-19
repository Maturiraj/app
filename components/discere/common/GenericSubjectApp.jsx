'use client'
import { useEffect, useRef, useState } from 'react'
import ExamShell from './ExamShell'
import SubjectExamHub from './SubjectExamHub'
import SubjectShell from './SubjectShell'
import { loadExam, loadSubjectIndex } from '@/lib/discere/content-loader'
import { saveCanonicalSimResult } from '@/lib/discere/progress'
import { canonicalGradeResult, gradeErrorMessage, newVersionedAttemptId, submitGrade } from '@/lib/discere/grade-client'
import { mergeQuestionResponse } from '@/lib/discere/question-responses'
import { advancePlayback, emptyPlayback, listeningQuestions } from '@/lib/learning/listening-state'
import {
  buildSnapshot, clearActiveSessionFor, readActiveSession, remainingSeconds, writeActiveSession,
} from '@/lib/discere/session-store'
import { useAuth } from '@/lib/hooks/useAuth'
import { buildUserAccess, canSeeDiscereAnalysis } from '@/components/discere/paywall/paywallHelpers'

function ServerExam({ exam, ownerId, initialDraft, onExit }) {
  const draftRef = useRef(initialDraft)
  const submitting = useRef(false)
  const [draft, setDraft] = useState(initialDraft)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savedLocally, setSavedLocally] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now)
  const [retryAt, setRetryAt] = useState(0)
  const subjectId = exam.meta.subject
  const remaining = remainingSeconds(draft, now)
  const locked = draft.submittedDurationSec != null || remaining === 0
  const retryIn = Math.max(0, Math.ceil((retryAt - now) / 1000))

  function updateDraft(changes) {
    const next = buildSnapshot({ ...draftRef.current, ...changes })
    draftRef.current = next
    setDraft(next)
    setSavedLocally(writeActiveSession(subjectId, next, ownerId))
    return next
  }

  useEffect(() => {
    setSavedLocally(writeActiveSession(subjectId, draftRef.current, ownerId))
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [subjectId, ownerId])

  async function submit() {
    if (submitting.current || Date.now() < retryAt) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const previous = draftRef.current
      const elapsed = Math.min(exam.meta.durationSec, Math.max(0, Math.floor((Date.now() - previous.startedAt) / 1000)))
      const attempt = updateDraft({ submittedDurationSec: previous.submittedDurationSec ?? elapsed })
      const response = await submitGrade(subjectId, {
        examKey: attempt.examKey,
        attemptId: attempt.attemptId,
        revision: attempt.revision,
        contentVersion: attempt.contentVersion,
        answers: attempt.answers,
        examMode: true,
        durationSec: attempt.submittedDurationSec,
      })
      const graded = canonicalGradeResult(response, attempt)
      clearActiveSessionFor(subjectId, attempt.examKey, ownerId, attempt.attemptId)
      setResult(graded)
    } catch (err) {
      if (err?.retryAfterSec > 0) setRetryAt(Date.now() + err.retryAfterSec * 1000)
      setError(gradeErrorMessage(err, { reportSavedDraft: false }))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const index = Math.max(0, Math.min(exam.questions.length - 1, draft.index))
  return <ExamShell exam={exam} onExit={onExit} session={{
    serverGraded: true,
    responses: draft.answers,
    view: { ...draft, index },
    remainingSeconds: remaining,
    result,
    busy,
    disabled: locked || busy,
    submissionPending: draft.submittedDurationSec != null,
    retryIn,
    error,
    savedLocally,
    onNavigate: next => updateDraft({ index: next }),
    onAnswer: (id, value) => {
      if (draftRef.current.submittedDurationSec != null || remainingSeconds(draftRef.current) === 0 || submitting.current) return
      const question = exam.questions.find(item => item.id === id)
      updateDraft({ answers: mergeQuestionResponse(question, value, draftRef.current.answers) })
    },
    onToggleFlag: id => {
      const flags = draftRef.current.flagged
      updateDraft({ flagged: flags.includes(id) ? flags.filter(flag => flag !== id) : [...flags, id] })
    },
    onNotebookChange: (id, value) => updateDraft({ notebooks: { ...draftRef.current.notebooks, [id]: value } }),
    onPlaybackAction: (id, action) => {
      const question = listeningQuestions(exam.questions).find(item => item.id === id)
      const playback = draftRef.current.playback
      const next = advancePlayback(question.stimulus.listening, playback[id] ?? emptyPlayback(), action)
      updateDraft({ playback: { ...playback, [id]: next } })
      return next
    },
    onSubmit: submit,
  }} />
}

export default function GenericSubjectApp({ subject }) {
  const auth = useAuth()
  // Predmeti bez freeExam idu kroz PlanGate paid-only, pa je pregled ondje
  // već zaključan tierom — canSeeReview je fail-open true. Za freeExam
  // predmete PlanGate pušta i free korisnika, pa razradu rezultata gatira
  // canSeeDiscereAnalysis.
  const canSeeReview = subject.freeExam === true ? canSeeDiscereAnalysis(buildUserAccess(auth)) : true
  const [index, setIndex] = useState(null)
  const [exam, setExam] = useState(null)
  const [pendingDraft, setPendingDraft] = useState(null)
  const [restartKey, setRestartKey] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const ownerId = auth.user?.id
  const qaExam = subject.id === 'bio' && subject.status === 'qa' && process.env.NODE_ENV !== 'production'
    ? index?.exams?.find(entry => entry.key === '2026_ljeto' && entry.qaStatus === 'structural-pass')
    : null

  useEffect(() => {
    let active = true
    setLoading(true)
    loadSubjectIndex(subject.id)
      .then((data) => {
        if (active) {
          setIndex(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message || 'Sadržaj nije dostupan.')
          setLoading(false)
        }
      })
    return () => { active = false }
  }, [subject.id])

  async function openExam(key, restart = false) {
    setLoading(true)
    setError('')
    setRestartKey(null)
    try {
      const loadedExam = await loadExam(subject.id, key)
      if (subject.id === 'bio') {
        if (!ownerId) throw new Error('Prijavi se za pokretanje ispita.')
        if (!loadedExam.revision || !loadedExam.contentVersion) {
          throw new Error('Za ovaj ispit nedostaje potvrđena revizija sadržaja.')
        }
        const now = Date.now()
        const current = readActiveSession(subject.id, now, ownerId)
        const previous = current ?? readActiveSession(subject.id, now)
        const resumable = current?.examKey === key && current.mode === 'exam'
          && /^[A-Za-z0-9_-]{8,64}$/.test(current.attemptId ?? '')
          && current.revision === loadedExam.revision && current.contentVersion === loadedExam.contentVersion
        if (previous && !resumable && !restart) {
          setRestartKey(key)
          setError('Prethodni nacrt nema potvrđen identitet ili pripada drugom ispitu ili reviziji. Za otvaranje ovog ispita pokreni novi pokušaj.')
          return
        }
        setPendingDraft({
          ownerId,
          draft: resumable && !restart ? current : buildSnapshot({
            subject: subject.id,
            examKey: key,
            mode: 'exam',
            attemptId: await newVersionedAttemptId(loadedExam.revision, loadedExam.contentVersion),
            revision: loadedExam.revision,
            contentVersion: loadedExam.contentVersion,
            startedAt: now,
            endsAt: now + loadedExam.meta.durationSec * 1000,
          }),
        })
      }
      setExam(loadedExam)
    } catch (err) {
      setError(err?.message || 'Ispit nije moguće učitati.')
    } finally {
      setLoading(false)
    }
  }

  function saveResult(result) {
    saveCanonicalSimResult(result).catch((err) => console.error('[discere] result save failed', err))
  }

  if (loading) return <div style={{minHeight:'70vh',display:'grid',placeItems:'center',color:'var(--muted)'}}>Učitavam…</div>
  if (exam && subject.id === 'bio' && ownerId === pendingDraft?.ownerId) {
    return <ServerExam key={pendingDraft.draft.attemptId} exam={exam} ownerId={ownerId} initialDraft={pendingDraft.draft} onExit={() => setExam(null)} />
  }
  if (exam && subject.id !== 'bio') return <ExamShell exam={exam} onExit={() => setExam(null)} onComplete={saveResult} canSeeReview={canSeeReview} />
  const messages = <>
    {error && <p role="alert" style={{padding:24,color:'var(--text)'}}>{error}</p>}
    {restartKey && <button type="button" onClick={() => openExam(restartKey, true)}>Pokreni novi pokušaj</button>}
  </>
  if (qaExam) return <SubjectShell subject={subject}>
    <h1>Ispit u provjeri</h1>
    <p>{qaExam.label}</p>
    {messages}
    <button type="button" disabled={!ownerId} onClick={() => openExam(qaExam.key)}>Otvori ili nastavi ispit</button>
  </SubjectShell>
  return <>{messages}<SubjectExamHub subject={subject} index={index} onOpen={openExam} /></>
}
