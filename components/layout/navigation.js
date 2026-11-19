import { canAccess, FEATURES } from '@/lib/entitlements'
import { isValidFromKey } from '@/lib/billing/fromMap'

export const NAV_PATHS = Object.freeze({
  home: '/',
  start: '/discere',
  dashboard: '/dashboard',
  intro: '/?intro=1',
  professor: '/ai-profesor',
  parent: '/roditelji',
  parentChildren: '/roditelji/dijete',
  admin: '/admin',
})

export function signInPath(destination) {
  const path = typeof destination === 'string' &&
    /^\/(?!\/)/.test(destination) &&
    !/[\\\u0000-\u001f\u007f]/.test(destination) &&
    !/^\/(?:prijava|registracija|login|auth)(?:[/?#]|$)/.test(destination)
    ? destination
    : NAV_PATHS.dashboard
  return `/prijava?redirect=${encodeURIComponent(path)}`
}

export function isParentWorkspaceAvailable(user, flags) {
  return Boolean(flags.parent && user?.id && flags.parentWorkspaceUserId === user.id)
}

export function getPrimaryDestination({ user, role, flags }) {
  if (role === 'admin') return { href: NAV_PATHS.admin, label: 'Administracija', shortLabel: 'Admin' }
  if (role === 'parent' && flags.parent) {
    return isParentWorkspaceAvailable(user, flags)
      ? { href: NAV_PATHS.parentChildren, label: 'Odaberi dijete', shortLabel: 'Dijete' }
      : { href: NAV_PATHS.parent, label: 'Roditeljski portal', shortLabel: 'Roditelji' }
  }
  return {
    href: user ? NAV_PATHS.start : signInPath(NAV_PATHS.start),
    label: 'Odaberi predmet',
    shortLabel: 'Predmeti',
  }
}

const groups = [
  { id: 'learn', label: 'Učenje', destinations: [
    { label: 'Moj pregled', path: NAV_PATHS.dashboard, feature: 'DASHBOARD', signedIn: true },
    { label: 'Odaberi predmet · Discere', path: NAV_PATHS.start, feature: 'DISCERE_EXAM', signedIn: true },
    { label: 'Skripte', path: '/skripte', feature: 'SKRIPTE', signedIn: true },
    { label: 'Plan učenja', path: '/plan-ucenja', feature: 'PLAN_UCENJA_BUILDER', signedIn: true },
    { label: 'Tjedni pregled', path: '/plan-ucenja/dashboard', feature: 'STUDY_PLAN_DASHBOARD', signedInOnly: true, from: 'plan-ucenja' },
    { label: 'Checklist', path: '/checklist' },
    { label: 'AI Profesor', path: NAV_PATHS.professor, feature: 'AI_PROFESOR', flag: 'ai', signedInOnly: true, from: 'ai-profesor' },
  ] },
  { id: 'admissions', label: 'Upisi', destinations: [
    { label: 'Prijemni', path: '/prijemni' },
    { label: 'Usporedba studija', path: '/prijemni/compare' },
    { label: 'Kalkulator', path: '/kalkulator' },
    { label: 'Termini', path: '/termini' },
  ] },
  { id: 'tools', label: 'Alati', destinations: [
    { label: 'Formule', path: '/formule' },
    { label: 'Atlas', path: '/atlas', proOnly: true, signedInOnly: true, from: 'atlas' },
    { label: 'Igra · Hrvatski', path: '/game', flag: 'game', signedInOnly: true },
  ] },
  { id: 'parent', label: 'Roditelji', destinations: [
    { label: 'Za roditelje', path: NAV_PATHS.parent, flag: 'parent' },
    { label: 'Odaberi dijete', path: NAV_PATHS.parentChildren, flag: 'parentWorkspace', role: 'parent' },
    { label: 'Pregled', path: '/roditelji/pregled', flag: 'parentWorkspace', role: 'parent' },
    { label: 'Rokovi učenika', path: '/roditelji/rokovi', flag: 'parentWorkspace', role: 'parent' },
    { label: 'Upravljanje vezama', path: '/roditelji/povezi', flag: 'parentWorkspace', role: 'parent' },
    { label: 'Postavke', path: '/roditelji/postavke', flag: 'parentWorkspace', role: 'parent' },
  ] },
  { id: 'admin', label: 'Administracija', destinations: [
    { label: 'Administratorski pregled', path: NAV_PATHS.admin, role: 'admin' },
    { label: 'Prijemni · administracija', path: '/admin/prijemni', role: 'admin' },
    { label: 'A/B eksperimenti', path: '/admin/ab', role: 'admin' },
  ] },
  { id: 'account', label: 'Račun', destinations: [
    { label: 'Prijava', path: '/prijava', guestOnly: true },
    { label: 'Moja pretplata', path: '/pretplata', signedInOnly: true },
    { label: 'Cijene', path: '/pro' },
    { label: 'Pogledaj uvod', path: NAV_PATHS.intro, reload: true },
  ] },
]

export function getNavigation({ user, role, flags, loading, planResolved, pathname, ...tier }) {
  const context = { user, ...tier, available: true }
  const parentView = role === 'parent' && flags.parent
  const visibleGroups = parentView ? ['parent', 'account'] : null

  return groups
    .filter(({ id }) => !visibleGroups || visibleGroups.includes(id))
    .map(({ destinations, ...group }) => ({
      ...group,
      destinations: destinations.flatMap(entry => {
        if (entry.role && entry.role !== role) return []
        if (entry.flag === 'parentWorkspace' && !isParentWorkspaceAvailable(user, flags)) return []
        if (entry.flag && entry.flag !== 'parentWorkspace' && !flags[entry.flag]) return []
        if (entry.guestOnly) {
          return loading || user ? [] : [{ ...entry, href: signInPath(pathname) }]
        }
        if (entry.signedInOnly && !user) return []
        if (entry.signedIn && !user) {
          return [{ ...entry, href: signInPath(entry.path), hint: 'Prijava' }]
        }

        const feature = FEATURES[entry.feature]
        if (entry.feature === 'DISCERE_EXAM' && !feature) {
          return [{ ...entry, href: entry.path }]
        }
        const minPlan = feature?.minPlan ?? (entry.proOnly ? 'pro' : null)
        if (minPlan && !planResolved) return []

        const access = entry.feature ? canAccess(entry.feature, context) : !entry.proOnly || tier.isPro
        if (access) return [{ ...entry, href: entry.path }]
        if (!minPlan) return []

        const hint = minPlan === 'pro' ? 'Pro' : 'Standard'
        const search = new URLSearchParams({ plan: minPlan })
        if (isValidFromKey(entry.from)) search.set('from', entry.from)
        return [{ ...entry, href: `/pro?${search}`, hint }]
      }),
    }))
    .filter(group => group.destinations.length > 0)
}

export function isWorkScreen(pathname) {
  return pathname.startsWith('/discere/') ||
    pathname.startsWith('/game/runner/') ||
    pathname.startsWith('/skripte/hrv/') ||
    pathname === '/engleski-simulator' ||
    pathname === '/test-sim'
}
