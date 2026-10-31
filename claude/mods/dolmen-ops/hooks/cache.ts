// The state every session of this Mac shares, so a fact is fetched once per Mac and not once per
// session: one JSON file per source under ~/.cache/dolmen-ops (deleting the folder costs one fetch,
// nothing else). A source past its time is refreshed by one session at a time, which holds a short
// lease; the others draw what the file holds. Mechanics only: calls.ts says what each source is. Ported from seammo-ops (#118).
import type { EngineInterface } from 'claude-code'

export type Entry = {
  at: number // when the data was last known true: loaded, or a probe said nothing changed
  loadedAt: number // when it was last loaded in full
  version?: string // what the probe compares
  data: unknown
  stale?: boolean // a write through the mod made it old: refresh at the next chance
  error?: string // the last refresh failed; `data` is what it held before
}

export const LEASE_MS = 30_000 // longer than any refresh (ssh waits 5 s at most)
// In every file name: sessions still on an older mod (one Mac updated, the other not yet) never read
// a shape they do not know. Bump it when a source's data changes shape.
export const SCHEMA = 1

// This process's copy, by file: a session whose files cannot be read or written still works alone.
const mem = new Map<string, Entry>()

// DOLMEN_OPS_CACHE moves it (the tests give each its own).
export async function cacheDir($: EngineInterface): Promise<string> {
  return (await $.env.get('DOLMEN_OPS_CACHE')) ?? `${(await $.env.get('HOME')) ?? '/tmp'}/.cache/dolmen-ops`
}

async function fileOf($: EngineInterface, key: string, ext: 'json' | 'lease'): Promise<string> {
  return `${await cacheDir($)}/${key}.v${SCHEMA}.${ext}`
}

export function parseEntry(text: string): Entry | undefined {
  try {
    const e = JSON.parse(text) as Entry
    return e && typeof e.at === 'number' && typeof e.loadedAt === 'number' && 'data' in e ? e : undefined
  } catch {
    return undefined
  }
}

// The newer of two copies; on a tie the stale one, so a mark is never lost.
export function newer(a: Entry | undefined, b: Entry | undefined): Entry | undefined {
  if (!a || !b) return a ?? b
  if (a.at !== b.at) return a.at > b.at ? a : b
  return b.stale ? b : a
}

// What the Mac knows of `key`, without fetching anything.
export async function peek($: EngineInterface, key: string): Promise<Entry | undefined> {
  const path = await fileOf($, key, 'json')
  const best = newer(mem.get(path), parseEntry(await $.fs.read(path).catch(() => '')))
  if (best) mem.set(path, best)
  return best
}

export async function put($: EngineInterface, key: string, e: Entry): Promise<Entry> {
  const path = await fileOf($, key, 'json')
  mem.set(path, e)
  await $.fs.write(path, JSON.stringify(e)).catch(() => {})
  return e
}

// Marks sources old after a write through the mod: every session refreshes them at its next tick.
export async function invalidate($: EngineInterface, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    const e = await peek($, key)
    if (e && !e.stale) await put($, key, { ...e, stale: true })
  }
}

type Lease = { by: string; until: number }

function parseLease(text: string): Lease | undefined {
  try {
    const l = JSON.parse(text) as Lease
    return typeof l?.by === 'string' && typeof l.until === 'number' ? l : undefined
  } catch {
    return undefined
  }
}

async function me($: EngineInterface): Promise<string> {
  return (await $.session.id().catch(() => undefined)) ?? 'session'
}

// Takes the lease of `key` unless another session holds a live one. Two sessions that race both
// read back their own name only rarely; then both fetch, which costs a call and breaks nothing.
export async function claim($: EngineInterface, key: string, now: number): Promise<boolean> {
  const path = await fileOf($, key, 'lease')
  const self = await me($)
  const held = parseLease(await $.fs.read(path).catch(() => ''))
  if (held && held.by !== self && held.until > now) return false
  const wrote = await $.fs.write(path, JSON.stringify({ by: self, until: now + LEASE_MS })).then(
    () => true,
    () => false,
  )
  if (!wrote) return true // no shared folder: this session works alone
  const back = parseLease(await $.fs.read(path).catch(() => ''))
  return !back || back.by === self
}

// Gives the lease back, only if it is still this session's (a slow refresh may have lost it).
export async function release($: EngineInterface, key: string): Promise<void> {
  const path = await fileOf($, key, 'lease')
  const self = await me($)
  if (parseLease(await $.fs.read(path).catch(() => ''))?.by !== self) return
  await $.fs.write(path, JSON.stringify({ by: self, until: 0 })).catch(() => {})
}
