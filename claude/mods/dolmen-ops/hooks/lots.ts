// A lot: one or more tickets in one worktree, one branch, one MR. Opening, adding and cleaning up.
import type { EngineInterface } from 'claude-code'
import { dewClaim, findTicket, gitStatus, inMain, lotDirs, sh, worktreesHome, type Card } from './dolmen.ts'
import { branchFor, lotObjection, ticketIds } from './rules.ts'

export type Opened = { text: string; branch?: string }

// Claims every ticket (`task dew-claim`) and makes the lot's branch from origin/main in its own
// worktree beside the checkout. The lot is then worked by an agent of this session (Claude Code's own
// subagents), started in that worktree by /plan: no separate session. A ticket that should not join (Critical, Hard, another scope, a 5th) stops it,
// unless `force` (the owner confirmed). Nothing is pushed: the branch goes up with its first fixes.
export async function lotOpen($: EngineInterface, root: string, wanted: string[], force = false): Promise<Opened> {
  const cards: Card[] = []
  for (const id of wanted) {
    const c = await findTicket($, root, id)
    if (!c) return { text: `${id} : introuvable dans Notion (task notion-api ; NOTION_TOKEN dans ~/.dolmen/.envprivate ?).` }
    if (c.status === 'Done' || c.status === 'Rejected') return { text: `${id} est ${c.status} : rien à coder.` }
    const objection = cards.length ? lotObjection(cards, c) : undefined
    if (objection && !force) return { text: `${id} ne rejoint pas le lot : ${objection}. Relance avec « force » à la fin si tu le veux quand même.` }
    cards.push(c)
  }
  const claimed: string[] = []
  for (const c of cards) {
    const r = await dewClaim($, root, c.id)
    if (!r.ok && !/already In Progress/.test(r.out + r.err)) return { text: `${c.id} : ${r.err || r.out}\nDéjà pris : ${claimed.join(', ') || 'aucun'}.` }
    claimed.push(c.id)
  }
  const branch = branchFor(cards.map(c => c.id), cards.length === 1 ? cards[0]!.title : cards.map(c => c.title).join(' '))
  const path = `${await worktreesHome($, root)}/${branch}`
  await sh($, ['git', '-C', root, 'fetch', 'origin', 'main'])
  const wt = await sh($, ['git', '-C', root, 'worktree', 'add', '--no-track', '-b', branch, path, 'origin/main'])
  if (!wt.ok) return { text: `Tickets pris (${claimed.join(', ')}), mais le worktree n'a pas été créé : ${wt.err}` }
  return {
    branch,
    text: [
      `Lot ${branch} : ${cards.map(c => `${c.id} ${c.title}`).join(' · ')}`,
      `In Progress dans Notion, worktree ${path} depuis origin/main.`,
      `Ensuite : /plan ${cards[0]!.id}. L'agent du lot démarre dans ce worktree, dans cette session (il apparaît dans tes agents).`,
    ].join('\n'),
  }
}

// Adds a ticket to the lot of `dir` and claims it. The branch keeps its name (the folder, the branch
// and the lot's agent are tied to it): the MR title and its ticket section carry the new id,
// which is what notion-ticket-done reads at the merge.
export async function lotAdd($: EngineInterface, root: string, dir: string, id: string, force = false): Promise<string> {
  const branch = (await gitStatus($, dir))?.branch
  const current = branch ? ticketIds(branch) : []
  if (!branch || !current.length) return 'Pas dans le worktree d\'un lot (branche ET-…).'
  if (current.includes(id)) return `${id} est déjà dans ${branch}.`
  const cards = (await Promise.all(current.map(c => findTicket($, root, c)))).filter((c): c is Card => !!c)
  const add = await findTicket($, root, id)
  if (!add) return `${id} : introuvable dans Notion.`
  const objection = lotObjection(cards, add)
  if (objection && !force) return `${id} ne rejoint pas le lot : ${objection}. Relance avec « force » si tu le veux quand même.`
  const claim = await dewClaim($, root, id)
  if (!claim.ok && !/already In Progress/.test(claim.out + claim.err)) return `${id} : ${claim.err || claim.out}`
  return `${id} pris et ajouté à ${branch}. Titre de la MR : ajoute [${id}] ; section « Link to Notion ticket » : ajoute ${add.url}.`
}

export type Sweep = { done: { dir: string; name: string }[]; dirty: string[] }

// Lot worktrees already in origin/main: clean ones can go, dirty ones are only named.
export async function sweep($: EngineInterface, root: string): Promise<Sweep> {
  await sh($, ['git', '-C', root, 'fetch', 'origin', 'main'])
  const out: Sweep = { done: [], dirty: [] }
  for (const lot of await lotDirs($, root)) {
    const s = await gitStatus($, lot.dir)
    if (!s || !(await inMain($, lot.dir))) continue
    if (s.dirty) out.dirty.push(lot.name)
    else out.done.push(lot)
  }
  return out
}

// Removes each merged lot's worktree, then its local branch, with git alone. Never forced: `worktree
// remove` keeps a worktree with changes, `branch -d` keeps a branch not merged.
export async function sweepApply($: EngineInterface, root: string, s: Sweep): Promise<string[]> {
  const lines: string[] = []
  for (const lot of s.done) {
    const r = await sh($, ['git', '-C', root, 'worktree', 'remove', lot.dir])
    if (!r.ok) {
      lines.push(`${lot.name} gardé : ${r.err.split('\n')[0] || r.out}`)
      continue
    }
    const b = await sh($, ['git', '-C', root, 'branch', '-d', lot.name])
    lines.push(b.ok ? `supprimé : ${lot.name}` : `worktree supprimé, branche gardée ${lot.name} : ${b.err.split('\n')[0]}`)
  }
  return lines
}
