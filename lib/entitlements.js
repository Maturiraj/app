/**
 * lib/entitlements.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared capability rules for the UI and API.
 *
 * Product tiers:
 *   FREE     — public or signed in, according to the capability
 *   STANDARD — paid plan: plan_type = 'starter'
 *   PRO      — paid plan: plan_type = 'pro'
 *
 * Usage:
 *   import { canAccess, FEATURES, getUpgradeTarget } from '@/lib/entitlements'
 *   const ok = canAccess(FEATURES.DISCERE_EXAM, { user, tier, available })
 */

import { normalizeTier, tierAtLeast } from './billing/getEffectiveTier.js'

export const FREE_PRACTICE_LIST_LIMIT = 3
export const FREE_PREVIEW_LIMIT = FREE_PRACTICE_LIST_LIMIT

const FREE_DISCERE = { minPlan: null, requiresAuth: true, requiresAvailability: true }
const STANDARD_DISCERE = { ...FREE_DISCERE, minPlan: 'starter' }
const PRO_FEATURE = { ...FREE_DISCERE, minPlan: 'pro' }
const PRO_ATTEMPT = { ...PRO_FEATURE, requiresOwnership: true }

// ─── Feature registry ────────────────────────────────────────────────────────
export const FEATURES = {
  // ── FREE (no account, no plan) ─────────────────────────────────────────────
  LANDING:                 { minPlan: null,       label: 'Početna stranica'          },
  TERMINI:                 { minPlan: null,       label: 'Termini ispita'            },
  FORMULE:                 { minPlan: null,       label: 'Formule'                   },
  CHECKLIST:               { minPlan: null,       label: 'Checklist za mature'       },
  KALKULATOR_BASIC:        { minPlan: null,       label: 'Kalkulator (unos)'         },
  PRO_PAGE:                { minPlan: null,       label: 'Stranica s planovima'      },

  // ── REQUIRES LOGIN ─────────────────────────────────────────────────────────
  SKRIPTE:                 { minPlan: null,       requiresAuth: true, label: 'Skripte'                  },
  DASHBOARD:               { minPlan: null,       requiresAuth: true, label: 'Dashboard'                },
  PLAN_UCENJA_BUILDER:     { minPlan: null,       requiresAuth: true, label: 'Graditelj plana učenja'   },

  // ── STANDARD (starter OR pro) ──────────────────────────────────────────────
  KALKULATOR_RESULTS:      { minPlan: 'starter',  label: 'Kalkulator — rezultati'     },
  STUDY_PLAN_SAVE:         { minPlan: 'starter',  label: 'Spremi plan učenja'         },
  STUDY_PLAN_DASHBOARD:    { minPlan: 'starter',  label: 'Pratilica plana učenja'     },
  PROGRESS_BASIC:          { minPlan: 'starter',  label: 'Praćenje napretka'          },

  // Scope (active subject, first three lists, submitted attempt) belongs to Discere.
  DISCERE_EXAM:                { ...FREE_DISCERE, label: 'Discere — ispit' },
  DISCERE_EXAM_RESULT:         { ...FREE_DISCERE, requiresOwnership: true, label: 'Discere — osnovni rezultat' },
  DISCERE_PRACTICE_PREVIEW:    { ...FREE_DISCERE, label: 'Discere — ograničena vježba' },
  DISCERE_PRACTICE_FULL:       { ...STANDARD_DISCERE, label: 'Discere — puna vježba' },
  DISCERE_STATIC_EXPLANATIONS:{ ...STANDARD_DISCERE, requiresOwnership: true, label: 'Discere — razrada' },

  // ── PRO only ───────────────────────────────────────────────────────────────
  AI_PROFESOR:             { ...PRO_FEATURE, label: 'AI Profesor' },
  STUDY_PLAN_ADAPTIVE:     { ...PRO_FEATURE, label: 'Adaptivni plan učenja' },
  KALKULATOR_ADVANCED:     { minPlan: 'pro',      label: 'Kalkulator — napredne analize' },
  KALKULATOR_AI_CHAT:      { minPlan: 'pro',      label: 'Kalkulator — AI savjetnik'  },
  KALKULATOR_SHARE:        { minPlan: 'pro',      label: 'Dijeli rezultate'           },
  KALKULATOR_RECOMMENDATIONS:{ minPlan: 'pro',   label: 'Personalizirane preporuke'  },
  KALKULATOR_VISUALIZATION:{ minPlan: 'pro',      label: 'Vizualizacija bodova'       },
  KALKULATOR_SIMULATION:   { minPlan: 'pro',      label: 'Simulacija bodova'          },
  KALKULATOR_ENTRANCE_EXAM:{ minPlan: 'pro',      label: 'Prijemni ispiti'            },
  PLAN_ADAPTIVE_DASHBOARD: { minPlan: 'pro',      label: 'Napredna analitika plana'   },
  PROGRESS_ADVANCED:       { minPlan: 'pro',      label: 'Napredna analitika napretka'},
  // ── Discere Pro features ────────────────────────────────────────────────────
  DISCERE_AI_RESULTS:     { ...PRO_ATTEMPT, label: 'Discere — AI analiza rezultata' },
  DISCERE_AI_PER_TASK:    { ...PRO_ATTEMPT, label: 'Discere — Pitaj AI o zadatku' },
  DISCERE_DAILY_CHALLENGE:{ ...PRO_FEATURE, label: 'Discere — dnevni izazov' },
  DISCERE_WEAK_AREAS:      { minPlan: 'pro',      label: 'Discere — Slaba područja'           },
  DISCERE_PERSONALIZED_PLAN:{ minPlan: 'pro',     label: 'Discere — Personalizirani plan'     },

  PARENT_STUDENT_OVERVIEW: {
    ...PRO_ATTEMPT,
    requiresConsent: true,
    usesStudentTier: true,
    label: 'Roditeljski pregled učenika',
  },
}

// Historic names retain their UI labels and share the corresponding capability rules.
FEATURES.DISCERE_CORE = { ...FEATURES.DISCERE_EXAM, label: 'Discere simulator' }
FEATURES.DISCERE_ALL_SUBJECTS = { ...FEATURES.DISCERE_EXAM, label: 'Svi Discere predmeti' }
FEATURES.DISCERE_SIMULATOR_FULL = { ...FEATURES.DISCERE_PRACTICE_FULL, label: 'Discere — cijeli simulator' }

function getFeature(feature) {
  if (typeof feature === 'string' && Object.hasOwn(FEATURES, feature)) return FEATURES[feature]
  return Object.values(FEATURES).find(definition => definition === feature)
}

function getContextTier({ tier, isPaid, isPro }) {
  return normalizeTier(tier ?? (isPro ? 'pro' : isPaid ? 'starter' : 'free'))
}

/**
 * In the API, derive the context from the authenticated session and trusted records.
 * `available` includes applicable feature flags. For parent access, `ownsRecord`
 * means the parent is authorized for this link and `hasConsent` is the student's
 * current explicit consent. Resolve `studentTier` with getUserTier(studentId) on
 * each read after checking the link and consent. Send protected data privately.
 * @param {string|object} feature A FEATURES key or its exported definition.
 * @param {{ user?: object|null, tier?: string, isPaid?: boolean, isPro?: boolean,
 *   available?: boolean, ownsRecord?: boolean, hasConsent?: boolean, studentTier?: string }} context
 * @returns {{ allowed: boolean, reason: string|null, requiredTier: string|null, currentTier: string|null }}
 */
export function getAccessDecision(feature, context = {}) {
  const def = getFeature(feature)
  const requiredTier = def ? def.minPlan ?? 'free' : null
  let currentTier = def?.usesStudentTier ? null : getContextTier(context)
  const decision = reason => ({ allowed: reason === null, reason, requiredTier, currentTier })

  if (!def) return decision('UNKNOWN_FEATURE')
  if (def.requiresAvailability && context.available !== true) return decision('UNAVAILABLE')
  if (def.requiresAuth && !context.user) return decision('UNAUTHENTICATED')
  if (def.requiresOwnership && context.ownsRecord !== true) return decision('FORBIDDEN')
  if (def.requiresConsent && context.hasConsent !== true) return decision('CONSENT_REQUIRED')
  if (def.usesStudentTier) currentTier = normalizeTier(context.studentTier)
  if (!tierAtLeast(currentTier, requiredTier)) return decision('ENTITLEMENT_DENIED')
  return decision(null)
}

export function canAccess(feature, context) {
  return getAccessDecision(feature, context).allowed
}

/** Check package inclusion for legacy tier summaries. Use canAccess for authorization. */
export function hasCapabilityTier(feature, tier) {
  const def = getFeature(feature)
  return !!def && tierAtLeast(tier, def.minPlan)
}

// ─── Upgrade target  ──────────────────────────────────────────────────────────
/**
 * Returns a package upgrade for the actor. Parent access uses the student's plan.
 * @returns {'starter' | 'pro' | null}
 */
export function getUpgradeTarget(feature, context = {}) {
  const def = getFeature(feature)
  if (!def?.minPlan || def.usesStudentTier) return null
  return tierAtLeast(getContextTier(context), def.minPlan) ? null : def.minPlan
}

// ─── Plan labels  ─────────────────────────────────────────────────────────────
export function getPlanLabel({ isPaid, isPro }) {
  if (isPro)    return 'PRO'
  if (isPaid)   return 'Standard'
  return 'Besplatni'
}

export function getPlanBadge({ isPaid, isPro }) {
  if (isPro)    return { emoji: '✨', label: 'PRO plan',      color: 'var(--blue)'  }
  if (isPaid)   return { emoji: '⭐', label: 'Standard plan', color: 'var(--gold)'  }
  return          { emoji: '🔒', label: 'Besplatni',     color: 'var(--muted)' }
}

// ─── Upgrade CTA text  ────────────────────────────────────────────────────────
/**
 * Returns button/CTA text for upgrading to access a feature.
 */
export function getUpgradeText(feature, context) {
  const target = getUpgradeTarget(feature, context)
  if (!target) return null
  if (target === 'starter') return 'Otključaj uz Standard — 9,99€/mj →'
  if (target === 'pro')     return 'Otključaj uz Pro — 19,99€/mj →'
  return 'Otključaj →'
}

export function getUpgradePath(feature, { from = '', ...context } = {}) {
  const target = getUpgradeTarget(feature, context)
  if (!target) return null
  const fromParam = from ? `?from=${from}&plan=${target}` : `?plan=${target}`
  return `/pro${fromParam}`
}
