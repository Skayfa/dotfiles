// Pure rules of the tracking file: reading it, the gates, the moves, the pane's rows.
// No `$` here: every function takes the file and returns a new one or a refusal.
import type { Entree, Jalon, Note, Pilotage, Question, Statut, Tache } from '../types'

export const FILE = 'pilotage/pilotage.json'
export const WIP_MAX = 2
export const IDLE_DAYS = 1
export const STALL_MS = 15 * 60_000

const STATUTS: Statut[] = ['backlog', 'pret', 'en_cours', 'bloque', 'fait', 'abandonne']
const DONE: Statut[] = ['fait', 'abandonne']
const PRIO = { P0: 0, P1: 1, P2: 2 } as const

export type Move = { file: Pilotage; said: string } | { refus: string }

// --- reading -----------------------------------------------------------------------------------

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).map(String)

export function parse(text: string): { data: Pilotage | null; errors: string[] } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { data: null, errors: [`JSON invalide : ${String(err).slice(0, 160)}`] }
  }
  if (typeof raw !== 'object' || raw === null) return { data: null, errors: ['le fichier n’est pas un objet JSON'] }
  const r = raw as Record<string, unknown>
  const p = (r.projet ?? {}) as Record<string, unknown>
  const data: Pilotage = {
    version: 1,
    projet: {
      nom: String(p.nom ?? 'projet'),
      promesse: String(p.promesse ?? ''),
      maj: String(p.maj ?? ''),
      ...(typeof p.wip_max === 'number' ? { wip_max: p.wip_max } : {}),
      ...(Array.isArray(p.zones_liees) ? { zones_liees: arr(p.zones_liees).map(strs) } : {}),
      ...(typeof p.verification === 'string' && p.verification.trim() ? { verification: p.verification } : {}),
      ...(typeof p.relecteur === 'string' && p.relecteur.trim() ? { relecteur: p.relecteur } : {}),
    },
    jalons: arr(r.jalons) as Jalon[],
    scopes: arr(r.scopes) as Pilotage['scopes'],
    taches: arr(r.taches).map(t => {
      const x = t as Tache
      return { ...x, criteres: strs(x.criteres), depend_de: strs(x.depend_de), bloque_par: strs(x.bloque_par), chemins: strs(x.chemins) }
    }),
    questions: arr(r.questions).map(q => ({ ...(q as Question), bloque: strs((q as Question).bloque), options: strs((q as Question).options) })),
    journal: arr(r.journal) as Entree[],
  }
  return { data, errors: check(data) }
}

// What makes the file wrong: duplicate ids, references to nothing, unknown values.
export function check(p: Pilotage): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const dup = (id: string) => (ids.has(id) ? errors.push(`id en double : ${id}`) : ids.add(id))
  p.jalons.forEach(j => dup(j.id))
  p.taches.forEach(t => dup(t.id))
  p.questions.forEach(q => dup(q.id))
  const jalons = new Set(p.jalons.map(j => j.id))
  const scopes = new Set(p.scopes.map(s => s.id))
  const taches = new Set(p.taches.map(t => t.id))
  const questions = new Set(p.questions.map(q => q.id))
  for (const t of p.taches) {
    if (!jalons.has(t.jalon)) errors.push(`${t.id} : jalon inconnu ${t.jalon}`)
    if (scopes.size && !scopes.has(t.scope)) errors.push(`${t.id} : scope inconnu ${t.scope}`)
    if (!STATUTS.includes(t.statut)) errors.push(`${t.id} : statut inconnu ${t.statut}`)
    for (const d of t.depend_de) if (!taches.has(d)) errors.push(`${t.id} dépend de ${d}, qui n’existe pas`)
    for (const q of t.bloque_par) if (!questions.has(q)) errors.push(`${t.id} bloqué par ${q}, qui n’existe pas`)
  }
  for (const q of p.questions) for (const t of q.bloque) if (!taches.has(t)) errors.push(`${q.id} bloque ${t}, qui n’existe pas`)
  return [...drift(p), ...errors, ...cutErrors(p)]
}

// --- what the journal explains -----------------------------------------------------------------

const WORK: Statut[] = ['en_cours', 'fait', 'abandonne']
const isWork = (s: Statut | undefined) => !!s && WORK.includes(s)
// Entries written before the mod recorded `tache` and `statut` are read by their words.
const LEGACY: Record<string, Statut> = { démarrée: 'en_cours', reprise: 'en_cours', terminée: 'fait', suspendue: 'backlog', abandonnée: 'abandonne' }

// The status moves the journal records, in order.
export function journalMoves(p: Pilotage): { tache: string; statut: Statut }[] {
  return p.journal.flatMap(j => {
    if (typeof j.tache === 'string' && j.statut) return [{ tache: j.tache, statut: j.statut }]
    const m = /^(\S+) (démarrée|reprise|terminée|suspendue|abandonnée)\b/.exec(String(j.texte ?? ''))
    const [, tache = '', verb = ''] = m ?? []
    return m ? [{ tache, statut: LEGACY[verb] as Statut }] : []
  })
}

// A work status (in progress, done, dropped) the journal does not explain: someone changed it
// outside the mod (a shell write). Derived statuses (backlog, ready, blocked) are the rules' own.
export function drift(p: Pilotage): string[] {
  const last = new Map(journalMoves(p).map(m => [m.tache, m.statut]))
  const errors: string[] = []
  for (const t of p.taches) {
    const said = last.get(t.id)
    if (isWork(t.statut) && said !== t.statut)
      errors.push(`${t.id} is ${t.statut} but ${said ? `the journal's last move left it ${said}` : 'no move in the journal put it there'}: changed outside the mod?`)
    else if (!isWork(t.statut) && isWork(said))
      errors.push(`${t.id} is ${t.statut} but the journal's last move left it ${said}: changed outside the mod?`)
  }
  return errors
}

// What an edit may not change: the terms of a task in progress, the gate and the reviewer once set,
// and the status moves the journal records.
const FROZEN = ['criteres', 'risque_donnees', 'invariant', 'depend_de', 'bloque_par'] as const
const term = (t: Tache, f: (typeof FROZEN)[number]) =>
  f === 'risque_donnees' ? String(!!t[f]) : f === 'invariant' ? String(t[f] ?? '') : JSON.stringify(t[f] ?? [])

export function frozenEdits(before: Pilotage, after: Pilotage): string[] {
  const out: string[] = []
  const now = new Map(after.taches.map(t => [t.id, t]))
  for (const t of before.taches.filter(x => x.statut === 'en_cours')) {
    const u = now.get(t.id)
    if (!u) out.push(`${t.id} (in progress) removed`)
    else for (const f of FROZEN) if (term(t, f) !== term(u, f)) out.push(`${t.id}.${f} (in progress)`)
  }
  for (const k of ['verification', 'relecteur'] as const)
    if (before.projet[k] && after.projet[k] !== before.projet[k]) out.push(`projet.${k}`)
  if (JSON.stringify(journalMoves(before)) !== JSON.stringify(journalMoves(after))) out.push('the status moves of journal')
  return out
}

// --- how the work is cut -----------------------------------------------------------------------

// Every task a task waits for, directly or not.
export function ancestors(p: Pilotage): Map<string, Set<string>> {
  const by = new Map(p.taches.map(t => [t.id, t]))
  const memo = new Map<string, Set<string>>()
  const walk = (id: string, path: Set<string>): Set<string> => {
    const known = memo.get(id)
    if (known) return known
    const all = new Set<string>()
    for (const d of by.get(id)?.depend_de ?? []) {
      if (path.has(d)) continue
      all.add(d)
      for (const a of walk(d, new Set([...path, d]))) all.add(a)
    }
    memo.set(id, all)
    return all
  }
  for (const t of p.taches) walk(t.id, new Set([t.id]))
  return memo
}

// A path as a lock: globs cut at their first wildcard, linked zones folded onto their first prefix.
export function lockOf(path: string, zones: string[][] = []): string {
  let x = path.replace(/^\.\//, '').replace(/[*?[].*$/, '')
  for (const zone of zones) {
    const hit = zone.find(prefix => x.startsWith(prefix))
    if (hit) x = zone[0] ?? x
  }
  return x
}

const clash = (a: string, b: string) => a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`) || b.startsWith(a.endsWith('/') ? a : `${a}/`) || a === '' || b === ''

// The paths two tasks would both write, as locks.
export function sharedPaths(p: Pilotage, a: Tache, b: Tache): string[] {
  const zones = p.projet.zones_liees ?? []
  const lb = (b.chemins ?? []).map(x => lockOf(x, zones))
  return (a.chemins ?? []).map(x => lockOf(x, zones)).filter(x => lb.some(y => clash(x, y)))
}

export function inCycle(p: Pilotage, id: string): boolean {
  const by = new Map(p.taches.map(t => [t.id, t]))
  const seen = new Set<string>()
  const stack = [...(by.get(id)?.depend_de ?? [])]
  while (stack.length) {
    const d = stack.pop() as string
    if (d === id) return true
    if (seen.has(d)) continue
    seen.add(d)
    stack.push(...(by.get(d)?.depend_de ?? []))
  }
  return false
}

export function cutErrors(p: Pilotage): string[] {
  const errors: string[] = []
  const up = ancestors(p)
  for (const t of p.taches) {
    if (inCycle(p, t.id)) errors.push(`${t.id} : cycle de dépendances`)
    if (isDone(t)) continue
    if (!t.criteres.length) errors.push(`${t.id} : aucun critère d’acceptation`)
    if (t.taille === 'L') errors.push(`${t.id} : taille L, à découper`)
    if (t.risque_donnees && !t.invariant?.trim()) errors.push(`${t.id} : touche aux données sans invariant`)
  }
  const open = p.taches.filter(t => !isDone(t) && (t.chemins ?? []).length)
  open.forEach((a, i) =>
    open.slice(i + 1).forEach(b => {
      if (up.get(a.id)?.has(b.id) || up.get(b.id)?.has(a.id)) return
      const shared = sharedPaths(p, a, b)
      if (shared.length) errors.push(`${a.id} et ${b.id} écrivent ${shared[0]} sans ordre entre elles`)
    }),
  )
  return errors
}

export const serialize = (p: Pilotage): string => `${JSON.stringify(p, null, 2)}\n`

// --- dates -------------------------------------------------------------------------------------

export const day = (now: number): string => new Date(now).toISOString().slice(0, 10)
export const daysSince = (date: string | undefined, now: number): number => {
  const at = Date.parse(date ?? '')
  return Number.isFinite(at) ? Math.floor((now - at) / 86_400_000) : 0
}

// --- the gates ---------------------------------------------------------------------------------

const task = (p: Pilotage, id: string) => p.taches.find(t => t.id === id)
const isDone = (t: Tache | undefined) => !!t && DONE.includes(t.statut)

// The open questions that hold a task, whichever side names the link.
export const openQuestions = (p: Pilotage, t: Tache): Question[] =>
  p.questions.filter(q => q.statut === 'ouverte' && (t.bloque_par.includes(q.id) || q.bloque.includes(t.id)))

// Why a task cannot start yet, or [] when it can.
export function waits(p: Pilotage, t: Tache): string[] {
  const why: string[] = openQuestions(p, t).map(q => q.id)
  for (const d of t.depend_de) if (!isDone(task(p, d))) why.push(d)
  const j = p.jalons.find(x => x.id === t.jalon)
  if (!j?.go) why.push(`go ${t.jalon}`)
  return why
}

// The status as the rules see it: work in progress and finished work as written, the rest derived.
export function statut(p: Pilotage, t: Tache): Statut {
  if (t.statut === 'en_cours' || DONE.includes(t.statut)) return t.statut
  if (openQuestions(p, t).length) return 'bloque'
  return waits(p, t).length ? 'backlog' : 'pret'
}

export function jalonStatut(p: Pilotage, j: Jalon): Jalon['statut'] {
  const ts = p.taches.filter(t => t.jalon === j.id)
  if (ts.length && ts.every(isDone)) return 'fait'
  return j.go ? 'en_cours' : 'a_venir'
}

// The milestone being built: the first one not finished.
export const currentJalon = (p: Pilotage): Jalon | undefined => p.jalons.find(j => jalonStatut(p, j) !== 'fait')

// Writes back every derived status, so the file reads right without the mod.
export function normalize(p: Pilotage, now: number): Pilotage {
  const taches = p.taches.map(t => {
    const s = statut(p, t)
    return s === t.statut ? t : { ...t, statut: s, depuis: day(now) }
  })
  const next = { ...p, taches }
  return { ...next, jalons: p.jalons.map(j => ({ ...j, statut: jalonStatut(next, j) })), projet: { ...p.projet, maj: day(now) } }
}

const log = (p: Pilotage, now: number, texte: string, move?: { tache: string; statut: Statut }): Pilotage => ({ ...p, journal: [...p.journal, { date: day(now), texte, ...move }] })
const put = (p: Pilotage, t: Tache): Pilotage => ({ ...p, taches: p.taches.map(x => (x.id === t.id ? t : x)) })
const ready = (p: Pilotage) => new Set(p.taches.filter(t => statut(p, t) === 'pret').map(t => t.id))

// The tasks a move made ready, said after it.
function unlocked(before: Pilotage, after: Pilotage): string {
  const was = ready(before)
  const now = [...ready(after)].filter(id => !was.has(id))
  return now.length ? ` Prêtes maintenant : ${now.join(', ')}.` : ''
}

// --- the moves ---------------------------------------------------------------------------------

export function start(p: Pilotage, id: string, now: number, holder = '', takeOver = false): Move {
  const t = task(p, id)
  if (!t) return { refus: `Tâche inconnue : ${id}.` }
  const s = statut(p, t)
  if (s === 'en_cours') {
    if (t.tenue_par === holder) return { refus: `${id} est déjà en cours dans cette session.` }
    if (!takeOver) return { refus: `${id} est tenue par une autre session : ne la touche pas, ou reprends-la explicitement (reprendre: true) si cette session est arrêtée.` }
    const file = normalize(log(put(p, { ...t, tenue_par: holder, depuis: day(now) }), now, `${id} reprise par une autre session`, { tache: id, statut: 'en_cours' }), now)
    return { file, said: `${id} reprise. ${card(t)}` }
  }
  if (s !== 'pret') return { refus: `${id} n’est pas prête (${s}) : elle attend ${waits(p, t).join(', ') || 'rien de connu'}.` }
  const wip = p.taches.filter(x => x.statut === 'en_cours')
  const mine = wip.filter(x => (x.tenue_par ?? '') === holder)
  const max = p.projet.wip_max ?? WIP_MAX
  if (mine.length >= max) return { refus: `Cette session tient déjà ${mine.length} tâche(s) (${mine.map(x => x.id).join(', ')}), le maximum est ${max} : termine ou suspends-en une d’abord.` }
  const crossed = wip.map(x => ({ x, shared: sharedPaths(p, t, x) })).find(c => c.shared.length)
  if (crossed) return { refus: `${id} écrirait ${crossed.shared[0]}, que ${crossed.x.id} (en cours) écrit aussi : attends sa fin ou ordonne les deux tâches.` }
  const file = normalize(log(put(p, { ...t, statut: 'en_cours', debut: day(now), depuis: day(now), tenue_par: holder }), now, `${id} démarrée`, { tache: id, statut: 'en_cours' }), now)
  const care = t.risque_donnees ? ` Elle touche aux données : présente le plan et l’invariant (${t.invariant || 'à écrire'}), puis attends la validation avant de coder.` : ''
  return { file, said: `${id} en cours. ${card(t)}${care}` }
}

export function note(p: Pilotage, id: string, n: Omit<Note, 'date'>, now: number, holder = ''): Move {
  const t = task(p, id)
  if (!t) return { refus: `Tâche inconnue : ${id}.` }
  if (t.statut !== 'en_cours') return { refus: `${id} n’est pas en cours (${statut(p, t)}).` }
  if (t.tenue_par && holder && t.tenue_par !== holder) return { refus: `${id} est tenue par une autre session.` }
  if (!n.fait.trim() || !n.reste.trim() || !n.suivant.trim()) return { refus: 'Une note dit fait, reste et suivant.' }
  const file = normalize(put(p, { ...t, depuis: day(now), suivi: [...(t.suivi ?? []), { date: day(now), ...n }] }), now)
  return { file, said: `Note ajoutée à ${id}.` }
}

// Finishing needs the proof and every criterion covered, by its number (1-based).
// A task that touches user data also needs the local review's verdict: OK, after the fixes it asked for.
export type Review = { verdict: string; texte: string }

// The refusals that need nothing run: checked before the gate and the review, which take minutes.
export function finishable(p: Pilotage, id: string, preuve: string, covered: number[], holder = ''): { task: Tache } | { refus: string } {
  const t = task(p, id)
  if (!t) return { refus: `Tâche inconnue : ${id}.` }
  if (t.statut !== 'en_cours') return { refus: `${id} n’est pas en cours (${statut(p, t)}) : démarre-la d’abord.` }
  if (t.tenue_par && holder && t.tenue_par !== holder) return { refus: `${id} est tenue par une autre session.` }
  if (!preuve.trim()) return { refus: 'Pas de preuve, pas de fin : donne les commandes lancées et leur résultat.' }
  const missing = t.criteres.map((_, i) => i + 1).filter(n => !covered.includes(n))
  if (missing.length) return { refus: `Critères non couverts : ${missing.map(n => `${n}. ${t.criteres[n - 1]}`).join(' ; ')}.` }
  return { task: t }
}

export function finish(p: Pilotage, id: string, preuve: string, covered: number[], now: number, review: Review = { verdict: '', texte: '' }, holder = ''): Move {
  const can = finishable(p, id, preuve, covered, holder)
  if ('refus' in can) return can
  const t = can.task
  if (t.risque_donnees && review.verdict !== 'OK')
    return { refus: review.verdict ? `Relecture ${review.verdict} : corrige ce qu’elle signale et relance-la jusqu’à OK.` : `${id} touche aux données : lance la relecture locale (sous-agent de relecture du projet) et donne son verdict.` }
  const relecture = review.verdict ? { relecture: `${review.verdict} · ${review.texte}`.trim() } : {}
  const after = normalize(log(put(p, { ...t, statut: 'fait', fini_le: day(now), depuis: day(now), preuve, ...relecture, tenue_par: undefined }), now, `${id} terminée`, { tache: id, statut: 'fait' }), now)
  return { file: after, said: `${id} terminée.${unlocked(p, after)}` }
}

// One task to finish, as tache_terminer receives it: flat (one task) or in `taches` (several).
export type Ending = { id: string; preuve: string; covered: number[]; review: Review }

export const str = (v: unknown) => (typeof v === 'string' ? v : '')
const endingOf = (e: Record<string, unknown>): Ending => ({
  id: str(e.id),
  preuve: str(e.preuve),
  covered: arr(e.criteres_couverts).map(Number),
  review: { verdict: str(e.relecture_verdict), texte: str(e.relecture) },
})

// The tool's input as a list: the flat call is a batch of one.
export function endingsOf(input: Record<string, unknown>): { ends: Ending[] } | { refus: string } {
  const batch = input.taches
  if (batch === undefined) return input.id === undefined ? { refus: 'Donne id (une tâche) ou taches (plusieurs).' } : { ends: [endingOf(input)] }
  if (input.id !== undefined) return { refus: 'Soit id (une tâche), soit taches (plusieurs), pas les deux.' }
  if (!Array.isArray(batch) || !batch.length || !batch.every(x => typeof x === 'object' && x !== null))
    return { refus: 'taches est une liste non vide de { id, preuve, criteres_couverts }.' }
  const ends = batch.map(x => endingOf(x as Record<string, unknown>))
  const twice = ends.map(x => x.id).filter((id, i, ids) => ids.indexOf(id) !== i)
  if (twice.length) return { refus: `Tâche donnée deux fois : ${[...new Set(twice)].join(', ')}.` }
  return { ends }
}

// In a batch, a refusal is named by its task, and says that none was finished. Alone, it stays as it is.
export const named = (batch: boolean, id: string, s: string): string => (batch ? `${id} : ${s}` : s)
export const noneFinished = (batch: boolean, refusals: string[]): string => (batch ? `${refusals.join('\n')}\nAucune tâche terminée.` : refusals.join('\n'))

// Several tasks finished in one move: all of them, or none (the first refusal).
export function finishAll(p: Pilotage, ends: Ending[], now: number, holder = ''): Move {
  const batch = ends.length > 1
  let file = p
  const said: string[] = []
  for (const x of ends) {
    const m = finish(file, x.id, x.preuve, x.covered, now, x.review, holder)
    if ('refus' in m) return { refus: noneFinished(batch, [named(batch, x.id, m.refus)]) }
    file = m.file
    said.push(m.said)
  }
  return { file, said: said.join('\n') }
}

export function suspend(p: Pilotage, id: string, raison: string, now: number, holder = ''): Move {
  const t = task(p, id)
  if (!t) return { refus: `Tâche inconnue : ${id}.` }
  if (t.statut !== 'en_cours') return { refus: `${id} n’est pas en cours.` }
  if (t.tenue_par && holder && t.tenue_par !== holder) return { refus: `${id} est tenue par une autre session.` }
  if (!raison.trim()) return { refus: 'Dis pourquoi elle est suspendue.' }
  const file = normalize(log(put(p, { ...t, statut: 'backlog', tenue_par: undefined, notes: [t.notes, `Suspendue le ${day(now)} : ${raison}`].filter(Boolean).join('\n') }), now, `${id} suspendue : ${raison}`, { tache: id, statut: 'backlog' }), now)
  return { file, said: `${id} suspendue.` }
}

// A task a decision made pointless: it no longer holds anything that follows it.
export function drop(p: Pilotage, id: string, raison: string, now: number, holder = ''): Move {
  const t = task(p, id)
  if (!t) return { refus: `Tâche inconnue : ${id}.` }
  if (DONE.includes(t.statut)) return { refus: `${id} est déjà ${t.statut}.` }
  if (t.statut === 'en_cours' && t.tenue_par && holder && t.tenue_par !== holder) return { refus: `${id} est tenue par une autre session.` }
  if (!raison.trim()) return { refus: 'Dis pourquoi elle est abandonnée (la décision qui la rend inutile).' }
  const after = normalize(log(put(p, { ...t, statut: 'abandonne', tenue_par: undefined, depuis: day(now), notes: [t.notes, `Abandonnée le ${day(now)} : ${raison}`].filter(Boolean).join('\n') }), now, `${id} abandonnée : ${raison}`, { tache: id, statut: 'abandonne' }), now)
  return { file: after, said: `${id} abandonnée.${unlocked(p, after)}` }
}

// Records the owner's decision, in their own words.
export function decide(p: Pilotage, id: string, decision: string, mots: string, now: number): Move {
  const q = p.questions.find(x => x.id === id)
  if (!q) return { refus: `Question inconnue : ${id}.` }
  if (q.statut !== 'ouverte') return { refus: `${id} est déjà tranchée : ${q.decision}.` }
  if (!decision.trim() || !mots.trim()) return { refus: 'Il faut la décision et les mots du propriétaire qui la donnent : ne tranche jamais à sa place.' }
  const next = { ...p, questions: p.questions.map(x => (x.id === id ? { ...x, statut: 'tranchee' as const, decision, mots, date: day(now) } : x)) }
  const after = normalize(log(next, now, `${id} tranchée : ${decision}`), now)
  return { file: after, said: `${id} tranchée.${unlocked(p, after)}` }
}

export function ask(p: Pilotage, q: { question: string; enjeu: string; options: string[]; bloque: string[] }, now: number): Move {
  if (!q.question.trim() || !q.enjeu.trim()) return { refus: 'Une question dit ce qu’il faut décider et ce qui en dépend.' }
  const unknown = q.bloque.filter(id => !task(p, id))
  if (unknown.length) return { refus: `Tâches inconnues : ${unknown.join(', ')}.` }
  const n = Math.max(0, ...p.questions.map(x => Number(/\d+/.exec(x.id)?.[0] ?? 0))) + 1
  const id = `Q-${String(n).padStart(2, '0')}`
  const next = { ...p, questions: [...p.questions, { id, ...q, statut: 'ouverte' as const, decision: '', date: day(now) }] }
  return { file: normalize(log(next, now, `${id} posée : ${q.question}`), now), said: `${id} posée au propriétaire, elle bloque ${q.bloque.join(', ') || 'aucune tâche'}.` }
}

export function go(p: Pilotage, id: string, now: number): Move {
  const j = p.jalons.find(x => x.id === id)
  if (!j) return { refus: `Jalon inconnu : ${id}.` }
  if (j.go) return { refus: `${id} a déjà son go (${j.go}).` }
  const next = { ...p, jalons: p.jalons.map(x => (x.id === id ? { ...x, go: day(now) } : x)) }
  const after = normalize(log(next, now, `go ${id}`), now)
  const open = p.questions.filter(q => q.statut === 'ouverte' && p.taches.some(t => t.jalon === id && openQuestions(p, t).includes(q)))
  return { file: after, said: `Go ${id}.${unlocked(p, after)}${open.length ? ` Encore bloquées par ${open.map(q => q.id).join(', ')}.` : ''}` }
}

// --- what the model reads ---------------------------------------------------------------------

export function card(t: Tache): string {
  return [
    `${t.id} · ${t.titre} (${t.scope}, ${t.jalon}, ${t.priorite}/${t.taille}).`,
    `Résultat : ${t.resultat}`,
    `Critères : ${t.criteres.map((c, i) => `${i + 1}. ${c}`).join(' ; ')}`,
    t.depend_de.length ? `Après : ${t.depend_de.join(', ')}.` : '',
    t.suivi?.length ? `Dernière note : ${t.suivi.at(-1)?.suivant ?? ""}` : '',
  ].filter(Boolean).join('\n')
}

// Only status fields count: the backlog itself may be edited by hand.
export function statusMoves(before: Pilotage, after: Pilotage): string[] {
  const moved: string[] = []
  const was = new Map(before.taches.map(t => [t.id, t.statut]))
  for (const t of after.taches) {
    const old = was.get(t.id)
    const isWork = (s: Statut | undefined) => s === 'en_cours' || s === 'fait' || s === 'abandonne'
    if ((old === undefined && isWork(t.statut)) || (old !== undefined && old !== t.statut && (isWork(old) || isWork(t.statut)))) moved.push(`${t.id} ${old ?? '∅'} → ${t.statut}`)
  }
  const q = new Map(before.questions.map(x => [x.id, x.statut]))
  for (const x of after.questions) if ((q.get(x.id) ?? 'ouverte') !== x.statut) moved.push(`${x.id} → ${x.statut}`)
  const g = new Map(before.jalons.map(j => [j.id, j.go ?? '']))
  for (const j of after.jalons) if ((g.get(j.id) ?? '') !== (j.go ?? '')) moved.push(`go ${j.id}`)
  return moved
}

// --- the pane ----------------------------------------------------------------------------------

export type Row = { key: string; text: string; tone?: 'warning' | 'error' | 'success' | 'subtle'; action?: { id: string; label: string; confirm?: string } }

export function toiRows(p: Pilotage, now: number): Row[] {
  const rows: Row[] = []
  const blockedBy = (q: Question) => p.taches.filter(t => !isDone(t) && openQuestions(p, t).includes(q)).length
  const open = p.questions.filter(q => q.statut === 'ouverte').sort((a, b) => blockedBy(b) - blockedBy(a))
  for (const q of open) rows.push({ key: q.id, text: `${q.id} ${q.question} · bloque ${blockedBy(q)}`, action: { id: `answer:${q.id}`, label: 'Trancher' } })
  const j = currentJalon(p)
  if (j && !j.go) rows.push({ key: `go-${j.id}`, text: `${j.id} ${j.titre} attend ton go`, action: { id: `go:${j.id}`, label: 'Go', confirm: `Go ${j.id} ?` } })
  for (const t of p.taches.filter(x => x.statut === 'en_cours' && daysSince(x.depuis, now) >= IDLE_DAYS))
    rows.push({ key: `idle-${t.id}`, text: `${t.id} immobile depuis ${daysSince(t.depuis, now)} j`, tone: 'warning', action: { id: `resume:${t.id}`, label: 'Reprendre' } })
  return rows
}

export function coursRows(p: Pilotage, now: number): Row[] {
  return p.taches
    .filter(t => t.statut === 'en_cours')
    .map(t => {
      const idle = daysSince(t.depuis, now)
      const last = t.suivi?.[t.suivi.length - 1]?.suivant
      return { key: t.id, text: `${t.id} ${t.titre} · ${idle ? `${idle} j` : 'aujourd’hui'}${last ? ` · suivant : ${last}` : ''}`, tone: idle >= IDLE_DAYS ? ('warning' as const) : undefined }
    })
}

export function nextRows(p: Pilotage, limit = 5): Row[] {
  const order = new Map(p.jalons.map((j, i) => [j.id, i]))
  return p.taches
    .filter(t => statut(p, t) === 'pret')
    .sort((a, b) => PRIO[a.priorite] - PRIO[b.priorite] || (order.get(a.jalon) ?? 99) - (order.get(b.jalon) ?? 99) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(t => ({ key: t.id, text: `${t.id} ${t.priorite} ${t.taille}${t.risque_donnees ? ' ⚠' : ''} ${t.titre}`, action: { id: `start:${t.id}`, label: 'Démarrer' } }))
}

export type Count = { id: string; label: string; done: number; total: number; blocked: number }

const count = (p: Pilotage, ts: Tache[]) => ({
  done: ts.filter(t => t.statut === 'fait').length,
  total: ts.filter(t => t.statut !== 'abandonne').length,
  blocked: ts.filter(t => statut(p, t) === 'bloque').length,
})

export const scopeCounts = (p: Pilotage): Count[] =>
  p.scopes.map(s => ({ id: s.id, label: s.titre, ...count(p, p.taches.filter(t => t.scope === s.id)) })).filter(c => c.total > 0)

export const jalonCounts = (p: Pilotage): Count[] =>
  p.jalons.map(j => ({ id: j.id, label: `${j.id} ${j.titre}${j.go ? ' · go' : ''}`, ...count(p, p.taches.filter(t => t.jalon === j.id)) }))

// The text /pilotage prints and the model reads.
export function summary(p: Pilotage, now: number): string {
  const j = currentJalon(p)
  const lines = [`${p.projet.nom} · ${j ? `${j.id} ${j.titre}` : 'tous les jalons sont faits'}`]
  const block = (title: string, rows: Row[]) => rows.length && lines.push('', title, ...rows.map(r => `- ${r.text}`))
  block('À TOI', toiRows(p, now))
  block('EN COURS', coursRows(p, now))
  block('PROCHAINES', nextRows(p))
  lines.push('', 'JALONS', ...jalonCounts(p).map(c => `- ${c.label} : ${c.done}/${c.total}${c.blocked ? ` · ${c.blocked} bloquées` : ''}`))
  return lines.join('\n')
}

// --- the gate and the review, run by tache_terminer -------------------------------------------

export const GATE_TIMEOUT_MS = 600_000
export const REVIEW_TIMEOUT_MS = 20 * 60_000

// The gate command as an argument vector: its words, no shell.
export const gateArgv = (cmd: string): string[] => cmd.trim().split(/\s+/).filter(Boolean)

// The task's paths split by where they are: in the repo (relative to it) or outside (~/..., elsewhere).
export function splitPaths(chemins: string[], root: string): { inside: string[]; outside: string[] } {
  const inside: string[] = []
  const outside: string[] = []
  for (const c of chemins.map(x => x.trim()).filter(Boolean)) {
    if (root && c.startsWith(`${root}/`)) inside.push(c.slice(root.length + 1))
    else if (c.startsWith('~') || c.startsWith('/')) outside.push(c)
    else inside.push(c.replace(/^\.\//, ''))
  }
  return { inside, outside }
}

export const tail = (text: string, lines = 20, chars = 2000): string => text.trimEnd().split('\n').slice(-lines).join('\n').slice(-chars)

export type GateRun = { argv: string[]; exitCode: number; ms: number; stdout: string; stderr: string; at: number }

export function gateLine(r: GateRun): string {
  const at = new Date(r.at).toISOString().slice(0, 16)
  return `gate (run by the mod): ${r.argv.join(' ')} · exit ${r.exitCode} · ${Math.round(r.ms / 1000)} s · ${at}Z`
}

// The gate's own record, appended to the model's proof: the command, its result, its duration, its tail.
export function gateProof(preuve: string, r: GateRun): string {
  const out = [tail(r.stdout), tail(r.stderr, 10, 1000)].filter(Boolean).join('\n')
  return `${preuve.trim()}\n\n${gateLine(r)}${out ? `\n${out}` : ''}`
}

export type Verdict = 'OK' | 'A_CORRIGER' | 'BLOQUANT'
const WORST: Verdict[] = ['OK', 'A_CORRIGER', 'BLOQUANT']

// The reviewer's verdict: its last `verdict: X` line, made worse by any item it marked
// A_CORRIGER or BLOQUANT. No verdict line, no verdict.
export function parseVerdict(answer: string): Verdict | null {
  const lines = [...answer.matchAll(/^[\s>*_`#-]*verdict[\s*_`]*:[\s*_`]*(OK|A_CORRIGER|BLOQUANT)\b/gim)]
  const last = lines.at(-1)?.[1]?.toUpperCase() as Verdict | undefined
  if (!last) return null
  const items = [...answer.matchAll(/^\s*(?:[-*•]|\d+[.)])?\s*[*_`[]*(A_CORRIGER|BLOQUANT)\b/gm)].map(m => m[1] as Verdict)
  return [last, ...items].reduce((a, b) => (WORST.indexOf(b) > WORST.indexOf(a) ? b : a))
}

// What the reviewer is asked: the task, its invariant, the diff since it started, and the last line it must write.
export function reviewPrompt(t: Tache, diff: string, base: string, untracked: string[], outside: string[]): string {
  return [
    `Review task ${t.id} (${t.titre}) before it is marked done. It touches user data.`,
    `Expected result: ${t.resultat}`,
    `Invariant its property test must check: ${t.invariant || '(none written)'}`,
    `Its paths: ${(t.chemins ?? []).join(', ') || '(none declared: the whole repo)'}.`,
    `The diff below goes from ${base || 'the empty tree'} (the last commit before the task started) to the working tree, on those paths.`,
    untracked.length ? `New files not in git yet, read them: ${untracked.join(', ')}.` : null,
    outside.length ? `Paths outside this repository, read them yourself: ${outside.join(', ')}.` : null,
    'Follow your own checklist. Change nothing.',
    'End your answer with one last line, exactly one of: `verdict: OK`, `verdict: A_CORRIGER`, `verdict: BLOQUANT`.',
    '',
    '```diff',
    diff || '(empty diff)',
    '```',
  ].filter(x => x !== null).join('\n')
}

// --- a held task nothing works on --------------------------------------------------------------

// What the session knows of its own life: is a turn or an agent running, when did anything last move, and
// has it delegated (an agent seen running since the owner last wrote).
export type Life = { busy: boolean; lastActivity: number; delegated: boolean }

// The tasks this session holds that nothing works on any more: it had delegated to agents, none runs now,
// and no turn has moved for STALL_MS. A session that simply waits for the owner is left alone. Each task is
// told once until the owner writes again (`woken`), so a wake's own reply never re-arms it.
export function stalled(p: Pilotage, holder: string, life: Life, now: number, woken: ReadonlySet<string>): Tache[] {
  if (!holder || !life.delegated || life.busy || now - life.lastActivity < STALL_MS) return []
  return p.taches.filter(t => t.statut === 'en_cours' && t.tenue_par === holder && !woken.has(t.id))
}

export function wakeText(ts: Tache[], minutes: number): string {
  const ids = ts.map(t => t.id).join(', ')
  return `${ids} ${ts.length > 1 ? 'sont en cours' : 'est en cours'} dans cette session, mais plus aucun agent ne tourne et rien n’a bougé depuis ${minutes} min. ` +
    'Vérifie maintenant : lis le résultat de ce qui a fini, relance l’agent ou la commande qui devait tourner, puis tache_note. ' +
    'Si tu attends le propriétaire, dis-le en une ligne ; si la tâche doit attendre, tache_suspendre.'
}
