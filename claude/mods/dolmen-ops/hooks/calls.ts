// The call manager (ported from seammo-ops #118): every call the panel, /etat and the MR watch make to
// GitLab, Notion, task and git goes through here, so each is made once per Mac and not once per
// Dolmen session (the shared state of cache.ts):
// - mrs, my open MRs and their mrwatch digests: every 2 min (pipelines take ~20 min);
// - reviews, the MRs I am asked to review: 10 min;
// - notion, me, my scopes and their open bugs: 1 h (the Notion API allowance is small);
// - dew, my Ready tickets (task dew): 30 min;
// - menage, the lot worktrees already in main: 30 min (it fetches).
// Each session still reacts on its own (wakes its lots, notifies): only the reading is shared. The
// writes (claim, Notion status, posts) never read from here.
import type { EngineInterface } from 'claude-code'
import { claim, peek, put, release, type Entry } from './cache.ts'
import { dewList, digest, glabMe, myBugs, myMRs, myScopes, notionMe, reviewMRs, type MR, type Scope } from './dolmen.ts'
import { sweep } from './lots.ts'
import type { Bug, Digest } from './rules.ts'

export type Key = 'mrs' | 'reviews' | 'notion' | 'dew' | 'menage'
export const KEYS: readonly Key[] = ['mrs', 'reviews', 'notion', 'dew', 'menage']
export const TTL: Record<Key, number> = { mrs: 2 * 60_000, reviews: 10 * 60_000, notion: 60 * 60_000, dew: 30 * 60_000, menage: 30 * 60_000 }

export type Mrs = { mr: MR; d?: Digest }[]
export type Reviews = { user?: string; list: MR[] }
export type NotionData = { me?: string; scopes: Scope[]; bugs?: Bug[] }
export type Dew = { id: string; title: string; priority: string; complexity: string; url: string }[]
export type Menage = { done: { dir: string; name: string }[]; dirty: string[] }
export type Known = Partial<Record<Key, Entry>>

// What a load needs: the checkout, and the mrwatch command this session built.
export type Ctx = { root: string; mrwatch: readonly string[] }

export async function loadMRs($: EngineInterface, c: Ctx): Promise<Mrs | undefined> {
  const list = await myMRs($)
  if (!list) return undefined
  const out: Mrs = []
  for (const mr of list) out.push({ mr, d: await digest($, c.root, c.mrwatch, mr.iid) })
  return out
}

export async function loadReviews($: EngineInterface): Promise<Reviews | undefined> {
  const user = await glabMe($)
  if (!user) return undefined
  const list = await reviewMRs($, user)
  return list ? { user, list } : undefined
}

export async function loadNotion($: EngineInterface, c: Ctx): Promise<NotionData | undefined> {
  const me = await notionMe($, c.root)
  if (!me) return undefined
  const scopes = await myScopes($, c.root, me)
  return { me, scopes, bugs: await myBugs($, c.root, me, scopes) }
}

export async function loadDew($: EngineInterface, c: Ctx): Promise<Dew | undefined> {
  return (await dewList($, c.root))?.map(d => ({ id: d.id, title: d.title, priority: d.priority, complexity: d.complexity, url: d.url }))
}

async function load($: EngineInterface, c: Ctx, key: Key): Promise<unknown> {
  switch (key) {
    case 'mrs':
      return loadMRs($, c)
    case 'reviews':
      return loadReviews($)
    case 'notion':
      return loadNotion($, c)
    case 'dew':
      return loadDew($, c)
    case 'menage':
      return sweep($, c.root)
  }
}

const inflight = new Map<Key, Promise<Entry | undefined>>()

// `key` as fresh as its time allows: the shared entry while it is; else this session refreshes it,
// unless another one holds the lease (then what the file holds). `force`: the owner asked.
export async function fresh($: EngineInterface, c: Ctx, key: Key, force = false): Promise<Entry | undefined> {
  const now = await $.clock.now()
  const e = await peek($, key)
  if (e && !force && !e.stale && now - e.at < TTL[key]) return e
  const running = inflight.get(key)
  if (running) return running
  const job = refresh($, c, key, e, now, force).finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

async function refresh($: EngineInterface, c: Ctx, key: Key, e: Entry | undefined, now: number, force: boolean): Promise<Entry | undefined> {
  if (!(await claim($, key, now)) && e && !force) return e
  try {
    const data = await load($, c, key).catch(() => undefined)
    // A failed read keeps what was known, marked, and is tried again at the next tick.
    if (data === undefined) return e ? await put($, key, { ...e, error: 'injoignable' }) : undefined
    return await put($, key, { at: now, loadedAt: now, data })
  } finally {
    await release($, key)
  }
}

// What the Mac knows of every source, without a single call.
export async function known($: EngineInterface): Promise<Known> {
  const out: Known = {}
  for (const k of KEYS) {
    const e = await peek($, k)
    if (e) out[k] = e
  }
  return out
}

export async function freshAll($: EngineInterface, c: Ctx, force = false, keys: readonly Key[] = KEYS): Promise<Known> {
  const entries = await Promise.all(keys.map(k => fresh($, c, k, force).catch(() => undefined)))
  const out: Known = {}
  keys.forEach((k, i) => {
    if (entries[i]) out[k] = entries[i]
  })
  return out
}

// --- the sessions of the Mac: who holds which lot -----------------------------------------------

// A lot session (ccw) holds its branch; the Lead holds the lots of its agents. A button for a lot
// shows only in the session that holds it, so two sessions never work one lot.
export type SessionEntry = { at: number; lead: boolean; branches: string[] }
export type Book = Record<string, SessionEntry>
const ALIVE_MS = 10 * 60_000

export async function sessionId($: EngineInterface): Promise<string> {
  return (await $.session.id().catch(() => undefined)) ?? 'session'
}

export async function publishSession($: EngineInterface, mine: Omit<SessionEntry, 'at'>): Promise<void> {
  const now = await $.clock.now()
  const self = await sessionId($)
  const book: Book = { ...(((await peek($, 'sessions'))?.data ?? {}) as Book) }
  book[self] = { at: now, ...mine }
  for (const [id, s] of Object.entries(book)) if (now - s.at > ALIVE_MS) delete book[id]
  await put($, 'sessions', { at: now, loadedAt: now, data: book })
}

// The session, other than this one, that holds a branch: a lot session first.
export async function holderOf($: EngineInterface, branch: string): Promise<'me' | 'other' | 'free'> {
  const now = await $.clock.now()
  const self = await sessionId($)
  const book = ((await peek($, 'sessions'))?.data ?? {}) as Book
  const ids = Object.entries(book).filter(([, s]) => now - s.at <= ALIVE_MS && s.branches.includes(branch)).map(([id]) => id)
  return ids.includes(self) ? 'me' : ids.length ? 'other' : 'free'
}
