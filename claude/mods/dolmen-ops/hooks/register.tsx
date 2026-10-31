// dolmen-ops: the code watches, the model decides. Opens a ticket or a lot of tickets from Notion
// into a branch and its worktree, worked by an agent of this session (Claude Code's own subagents);
// watches Younes's MRs with mrwatch and wakes the lot's agent on what needs an answer, keeps the
// Notion status in step with the MR, ranks the bugs of his scopes by SLO, refuses the gestures
// reserved to the author, trims test output and counts the cost of each lot. Every check is code, so
// it costs no tokens until something happens. The reads are shared by every session of the Mac
// (calls.ts), and what must survive a /reload-plugins lives in $.state.
import { atom, read, update } from 'claude-code'
import type { CommandRunInput, CommandRunResult, EngineInterface, Register, Timer } from 'claude-code'
import type { Armed, PanelAction, PanelRow, PanelSnapshot } from '../types'
import { cacheDir, invalidate } from './cache.ts'
import { freshAll, fresh, holderOf, known, publishSession, type Ctx, type Dew, type Key, type Known, type Menage, type Mrs, type NotionData, type Reviews } from './calls.ts'
import {
  buildMrwatch,
  cardText,
  dewList,
  digest,
  dolmenRoot,
  findTicket,
  gitStatus,
  lastCommitAt,
  lotDirs,
  pipelineCount,
  setStatus,
  sh,
  type MR,
  type Scope,
} from './dolmen.ts'
import { lotAdd, lotOpen, sweep, sweepApply } from './lots.ts'
import {
  AMEND_REFUSAL,
  HANDOFF_SECTION,
  MODELS_SECTION,
  ago,
  amendIn,
  babysitPrompt,
  highLimits,
  mrValue,
  refusal,
  shouldTrim,
  slo,
  sortBugs,
  ticketIds,
  wakingEvents,
  wrapForTrim,
  type Bug,
  type Digest,
} from './rules.ts'

const TICK_MS = 2 * 60_000 // MRs: a pipeline takes ~20 min, two minutes is soon enough
const READY_TTL_MS = 2 * 3_600_000
const STALE_MS = 24 * 3_600_000 // a lot that has not moved for this long is said, with Reprendre
const CONFIRM_MS = 10_000
const TITLE = 'Dolmen'
const PANE = 'dolmen-ops'
const WINDOWS: Record<string, string> = { five_hour: '5 h', seven_day: 'semaine' }
// Everforest Dark, the owner's palette (dotfiles: alacritty, tmux status bar, hunk).
const EF = { bg: '#2d353b', fg: '#d3c6aa', grey: '#859289', green: '#a7c080', yellow: '#dbbc7f', red: '#e67e80' }
const TONE = { success: EF.green, warning: EF.yellow, error: EF.red, subtle: EF.grey } as const
const ARROW = '' // the Powerline separator of the tmux status bar

const EMPTY: PanelSnapshot = { at: 0, lots: [], mrs: [], reviews: [], bugs: [], dew: [], session: [] }
// Bump the tag when PanelSnapshot changes: it declines what an older version stored.
const snapshot = atom({ plugin: 'dolmen-ops', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-3' })
// What must survive a /reload-plugins (module variables start over): the MR events already told, so a
// reload does not wake a lot's agent twice on the same threads; /pret's go; the last turn's cost.
const toldAtom = atom({ plugin: 'dolmen-ops', key: 'told' } as const, {} as Record<string, string>)
const readyAtom = atom({ plugin: 'dolmen-ops', key: 'ready' } as const, {} as Record<string, number>)
const usdAtom = atom({ plugin: 'dolmen-ops', key: 'lastUsd' } as const, -1)
// The pane's action pressed once and waiting for « Oui ».
const armed = atom({ plugin: 'dolmen-ops', key: 'armed' } as const, null as Armed)

// Module state: a reload starts it over. The reads below are copies of the shared state (calls.ts).
let root: string | undefined
let mrwatch: string[] = ['go', 'run', './.agents/skills/babysit-mr-empowill/mrwatch']
let warming: Promise<void> | undefined
// The lot this session works on (its branch names ET ids), or undefined: the Lead session, on main.
let lotBranch: string | undefined
let panelOn = false
let quotaHigh = false
const warned = new Set<string>()
let mrs: { mr: MR; d?: Digest }[] = []
let reviews: MR[] = []
let bugs: Bug[] | undefined
let dew: { id: string; title: string; priority: string; complexity: string; url: string }[] | undefined
let menage: Menage | undefined
let scopes: Scope[] = []

const ctx = (): Ctx => ({ root: root!, mrwatch })

// The shared reads into this session's copies.
function apply(k: Known): void {
  if (k.mrs?.data) mrs = k.mrs.data as Mrs
  if (k.reviews?.data) reviews = (k.reviews.data as Reviews).list
  if (k.notion?.data) {
    const n = k.notion.data as NotionData
    scopes = n.scopes
    bugs = n.bugs
  }
  if (k.dew?.data) dew = k.dew.data as Dew
  if (k.menage?.data) menage = k.menage.data as Menage
}

// After a write (a claim, a cleanup): every session of the Mac reads those again at its next tick.
async function changed($: EngineInterface, keys: readonly Key[]): Promise<void> {
  await invalidate($, keys).catch(() => {})
  if (panelOn) $.clock.after(1, () => void refreshPanel($).catch(() => {}))
}

async function now($: EngineInterface) {
  return $.clock.now()
}


// A prompt for the model, submitted once the hook that asks for it has returned: a command's hook
// holds the turn, so a submit from inside it would wait on itself.
function handOff($: EngineInterface, text: string): void {
  $.clock.after(1, () => void $.prompt.submit({ text }))
}

// --- watching -------------------------------------------------------------------------------------

// Each session reacts to the MRs on its own: a lot's session wakes for its own MR; the Lead sends an
// MR's events to the lot's agent of this session, or tells Younes when no agent holds it here (the
// pane's « Traiter » starts one). The reading is shared; the events told are kept in $.state.
async function watchMRs($: EngineInterface): Promise<void> {
  if (!root) return
  const e = await fresh($, ctx(), 'mrs')
  if (!e?.data) return
  apply({ mrs: e })
  const told = await read($, toldAtom)
  const next = { ...told }
  for (const { mr, d } of mrs) {
    await syncStatus($, mr)
    const waking = d ? wakingEvents(d) : []
    const fp = waking.join(' ')
    if (!waking.length || told[mr.iid] === fp) continue
    next[mr.iid] = fp
    if (lotBranch === mr.branch) {
      handOff($, babysitPrompt(mr.iid, mr.title, d!))
      continue
    }
    if (lotBranch) continue // another lot's MR: not this session's
    // Another session working this lot wakes on it itself.
    if ((await holderOf($, mr.branch).catch(() => 'free')) === 'other') continue
    const agent = (await lotAgents($))[mr.branch]
    const sent = agent ? await $.session.send({ to: { agentId: agent }, text: babysitPrompt(mr.iid, mr.title, d!) }).catch(() => ({ isDelivered: false as const })) : undefined
    if (!sent?.isDelivered) void $.ui.notify(`!${mr.iid} ${fp} → « Traiter » dans le panneau Dolmen (l'agent du lot s'en charge)`, { title: TITLE })
  }
  await update($, toldAtom, () => next).catch(() => {})
}

// An open MR moves its tickets from In Progress to « Merge request » (gitlab-sync is not merged yet).
async function syncStatus($: EngineInterface, mr: MR): Promise<void> {
  const synced = ((await $.store.get('synced')) as string[] | undefined) ?? []
  for (const id of mr.tickets.filter(t => !synced.includes(t))) {
    const c = await findTicket($, root!, id)
    if (!c) continue
    if (c.status === 'In Progress') await setStatus($, root!, c.pageId, 'Merge request')
    synced.push(id)
    await $.store.set('synced', synced.slice(-200))
  }
}

// What this session holds, for the other sessions of the Mac: its own branch (a lot session), or the
// lots whose agents run here (the Lead).
async function publishMine($: EngineInterface): Promise<void> {
  const agents = await lotAgents($)
  const live = new Set((await $.agent.list().catch(() => [])).map(a => a.id))
  const branches = lotBranch ? [lotBranch] : Object.entries(agents).filter(([, id]) => live.has(id)).map(([b]) => b)
  await publishSession($, { lead: !lotBranch, branches }).catch(() => {})
}

// The ticker. A /clear ends the session's timers with it (no session.start follows), so every hook
// that runs after one re-arms it when its last tick is too old.
let lastTick = 0
let ticker: Timer | undefined

// `every` answers a timer to cancel, not a function: calling it threw, so after a /clear the ticker
// was never armed again.
async function ensureTicker($: EngineInterface): Promise<void> {
  if (!root || (await now($)) - lastTick < 2 * TICK_MS) return
  ticker?.cancel()
  ticker = $.clock.every(TICK_MS, () => void tick($))
  lastTick = await now($)
}

async function tick($: EngineInterface): Promise<void> {
  if (!root) return
  lastTick = await now($)
  await watchMRs($).catch(() => {})
  await publishMine($).catch(() => {})
  if (panelOn) await refreshPanel($).catch(() => {})
}

// --- the panel and /etat --------------------------------------------------------------------------

// Whether this session may act on a lot's branch: its own (a lot session), or, from the Lead, one no
// other session works. Elsewhere the row says so and has no button: two sessions never work one lot.
async function mineToAct($: EngineInterface, branch: string): Promise<boolean> {
  if (lotBranch) return lotBranch === branch
  return (await holderOf($, branch).catch(() => 'free' as const)) !== 'other'
}

// A ticket already in one of this Mac's lots.
async function inALot($: EngineInterface, id: string): Promise<boolean> {
  return !!root && (await lotDirs($, root)).some(l => ticketIds(l.name).includes(id))
}

const take = (id: string): PanelAction => ({ id: `take:${id}`, label: 'Prendre', confirm: `Prendre ${id} (claim Notion, branche, worktree) ?` })

async function bugRows($: EngineInterface, t: number): Promise<PanelRow[]> {
  if (!bugs) return [{ label: 'Notion', value: 'injoignable (NOTION_TOKEN ?)', tone: 'subtle' }]
  if (!bugs.length) return [{ label: '—', value: 'aucun bug ouvert dans tes scopes', tone: 'success' }]
  const rows: PanelRow[] = []
  for (const b of sortBugs(bugs, t).slice(0, 8)) {
    const s = slo(b, t)
    const who = b.mine ? 'À TOI' : b.assignees.length ? 'pris' : 'personne'
    // Taking a bug is the Lead's gesture: one nobody holds, or mine not yet in a lot.
    const free = !lotBranch && (!b.assignees.length || b.mine) && !(await inALot($, b.id))
    rows.push({
      label: `${b.id} ${b.title}`,
      href: b.url,
      value: `${b.priority || 'sans priorité'} · ${s.age} j${s.limit ? ` / ${s.limit} j` : ''} · ${who}`,
      tone: s.late ? 'error' : !b.priority ? 'warning' : b.mine ? 'warning' : 'subtle',
      ...(free ? { action: take(b.id) } : {}),
    })
  }
  return rows
}

async function sessionRows($: EngineInterface): Promise<PanelRow[]> {
  const rows: PanelRow[] = []
  const cwd = await $.session.cwd()
  const s = await gitStatus($, cwd)
  if (s?.branch && ticketIds(s.branch).length) {
    const pushed = s.upstream === `origin/${s.branch}`
    rows.push({
      label: s.branch,
      value: !pushed ? 'jamais poussée' : s.ahead ? `${s.ahead} commit${s.ahead > 1 ? 's' : ''} locaux` : 'à jour',
      tone: !pushed || s.ahead ? 'warning' : 'success',
    })
    const cost = ((await $.store.get('cost')) as Record<string, number> | undefined)?.[s.branch]
    const mr = mrs.find(m => m.mr.branch === s.branch)?.mr
    const pipelines = mr ? await pipelineCount($, mr.iid) : undefined
    if (cost !== undefined || pipelines !== undefined) {
      rows.push({ label: 'Coût du lot', value: [cost !== undefined ? `${cost.toFixed(2)} $` : '', pipelines !== undefined ? `${pipelines} pipelines` : ''].filter(Boolean).join(' · ') })
    }
  }
  rows.push(lotBranch ? { label: 'Rôle', value: 'session de lot : se réveille sur sa MR', tone: 'success' } : { label: 'Rôle', value: 'session Lead : ses lots sont ses agents', tone: 'subtle' })
  for (const l of (await $.session.usage()).rateLimits) {
    rows.push({
      label: `Quota ${WINDOWS[l.kind] ?? l.kind.replace('_', ' ')}`,
      value: `${Math.round(l.percentUsed)} %`,
      tone: l.percentUsed >= 90 ? 'error' : l.percentUsed >= 75 ? 'warning' : 'success',
    })
  }
  return rows
}

// The pane's state: first from what this Mac already knows, with no call (a new session, a /clear or
// a reload draws at once), then from what is due, read once for every session of the Mac.
async function refreshPanel($: EngineInterface, force = false): Promise<void> {
  if (!root) return
  if ((await read($, snapshot)).at === 0) {
    apply(await known($))
    if (mrs.length || bugs || dew) await compose($)
  }
  apply(await freshAll($, ctx(), force))
  await compose($)
}

async function compose($: EngineInterface): Promise<void> {
  const t = await now($)
  const mrRows: PanelRow[] = []
  for (const { mr, d } of mrs) {
    const v = d ? mrValue(d) : { value: 'mrwatch injoignable (glab auth status ?)', tone: 'subtle' as const }
    const moved = ` · bougée il y a ${ago(t - Date.parse(mr.updatedAt))}`
    const own = await mineToAct($, mr.branch)
    // Threads, a red pipeline or a conflict: Traiter (the lot's agent). Green, no thread, Draft: Prête.
    const busy = !!d && (wakingEvents(d).length > 0 || d.openThreads > 0 || d.pipeline === 'failed' || d.failed.length > 0 || !!d.conflicts)
    const ready = !!d && d.draft && d.pipeline === 'success' && !d.openThreads && !d.conflicts && !d.failed.length
    const action: PanelAction | undefined = !own ? undefined : busy ? { id: `treat:${mr.iid}`, label: 'Traiter' } : ready ? { id: `ready:${mr.iid}`, label: 'Prête', confirm: `!${mr.iid} : verify, recette, qa-will, puis sortie de Draft ?` } : undefined
    mrRows.push({ label: `!${mr.iid} ${mr.tickets.join(' + ') || mr.title}`, href: mr.url, ...v, value: `${v.value}${moved}${own ? '' : ' · autre session'}`, ...(action ? { action } : {}) })
    for (const th of (d?.threads ?? []).slice(0, 2)) mrRows.push({ label: `  ${th.author}`, value: th.where || 'fil général', tone: 'subtle' })
  }
  if (!mrRows.length) mrRows.push({ label: '—', value: 'aucune MR ouverte', tone: 'subtle' })
  const reviewRows: PanelRow[] = reviews.length
    ? reviews.map(r => ({ label: `!${r.iid} ${r.tickets.join(' + ') || r.title} (${r.author})`, href: r.url, value: `demandée · ${ago(t - Date.parse(r.updatedAt))}`, tone: 'warning' as const, ...(lotBranch ? {} : { action: { id: `review:${r.iid}`, label: 'Relire' } }) }))
    : [{ label: '—', value: 'rien à relire', tone: 'subtle' }]
  const dewRows: PanelRow[] = []
  if (!dew) dewRows.push({ label: 'task dew', value: 'injoignable', tone: 'subtle' })
  else if (!dew.length) dewRows.push({ label: '—', value: 'aucun ticket Ready', tone: 'subtle' })
  else
    for (const [i, d] of dew.slice(0, 6).entries()) {
      const first = i === 0 && !lotBranch && !(await inALot($, d.id))
      dewRows.push({ label: `${d.id} ${d.title}`, href: d.url, value: `${d.priority} · ${d.complexity}`, tone: d.priority === 'Critical' ? 'error' : undefined, ...(first ? { action: take(d.id) } : {}) })
    }
  const session = await sessionRows($)
  const lots = await lotRows($, t)
  const bugList = await bugRows($, t)
  await update($, snapshot, () => ({ at: t, lots, mrs: mrRows, reviews: reviewRows, bugs: bugList, dew: dewRows, session }))
}

// The slow part (the shared mrwatch build, then every read) runs here, in the background: commands
// answer from what is known and never wait on it.
function warm($: EngineInterface, force = false): Promise<void> {
  warming ??= (async () => {
    if (root && mrwatch[0] === 'go') mrwatch = await buildMrwatch($, root, await cacheDir($)).catch(() => mrwatch)
    await refreshPanel($, force).catch(() => {})
  })().finally(() => {
    warming = undefined
  })
  return warming
}

const LOADING = 'Premier chargement en cours (mrwatch, task dew, Notion, glab : environ une minute la première fois). Retape la commande dans un instant.'

async function report($: EngineInterface): Promise<string | undefined> {
  const s = await read($, snapshot)
  $.clock.after(1, () => void warm($))
  if (s.at === 0) return undefined
  const t = await now($)
  const block = (title: string, rows: PanelRow[]) => [title, ...rows.map(r => `  ${r.label} : ${r.value}`)].join('\n')
  return [block('LOTS EN COURS', s.lots), block('MES MR', s.mrs), block('À RELIRE', s.reviews), block('BUGS DE MES SCOPES (SLO)', s.bugs), block('MON DEW', s.dew), block('SESSION', s.session), `(lu il y a ${ago(t - s.at)} ; mise à jour en cours)`].join('\n\n')
}

// --- commands that hand work to the model ---------------------------------------------------------

const PROMPTS = {
  plan: [
    'Pour le lot de cette branche : lis chaque ticket avec ticket_card, puis le skill grill (epic, sillon, codebase, insights).',
    'Contrôles readiness avant tout code, comme Panoramix : le droit RPC `auth:` des écrans touchés, le profil qui voit l\'écran, le menu et la route, les données showcase.',
    'Écris-moi ensuite le test plan au format « En tant que <rôle> : <actions> → <résultat> », un critère par ligne. N\'écris le Plan dans Notion qu\'après mon OK.',
  ].join('\n'),
  mr: [
    'Ouvre la MR de ce lot avec le skill open-mr-empowill : Draft, titre `[ET-…][ET-…] Titre`, le template Default.md collé dans --description,',
    'un lien par ticket dans « Link to Notion ticket », le test plan. Ajoute une section « État » : fait / reste / prochaine commande. Un seul push.',
  ].join('\n'),
  note: 'Mets à jour la section « État » de la description de la MR de ce lot : fait (avec preuves), reste, prochaine commande. Aucun push.',
  detacher: (id: string) =>
    [
      `Sors ${id} de ce lot sans réécrire l'historique poussé : crée la branche ${id}-<slug> depuis origin/main dans son propre worktree, à côté de celui du lot,`,
      `cherry-pick les commits \`[${id}]\` du lot, puis ajoute dans le lot un commit qui les revert. Retire [${id}] du titre et son lien de la MR. Montre-moi le plan avant de pousser.`,
    ].join('\n'),
  pret: (iid: number) =>
    [
      `Sortie de Draft de !${iid}, dans cet ordre, en t'arrêtant au premier échec :`,
      '1. skill verify sur les critères du lot (task test-pkg, jamais go test brut) ;',
      '2. recette locale par l\'agent dolmen-ops:runner : `task run` s\'il ne tourne pas, `task recette-seed` une fois par base, puis `task recette MR=' + iid + ' POST=1` ; lis les verdicts en texte ;',
      '3. skill qa-will pour la fiche CSM ;',
      `4. si tous les critères sont ✅ : \`glab mr update ${iid} --ready\` (autorisé pour 2 h par /pret). Sinon, dis-moi ce qui manque.`,
    ].join('\n'),
  relire: (iid: string) => `Relis !${iid} avec le skill review-mr-empowill. Propose les commentaires ; n'en poste aucun sans mon OK, n'approuve jamais.`,
  epic: (url: string) =>
    [
      `Epic ${url} : lis-la (contexte, scope, hors-scope, insights, tickets liés) avec le MCP Notion, sans rien écrire.`,
      'Propose un découpage en tickets ≤ Medium avec un Plan « En tant que … → … » chacun, leurs dépendances et l\'ordre. Marque ceux qu\'un lot peut regrouper (même scope) et ceux que Panoramix peut prendre.',
      'Je valide avec le binôme produit avant toute création dans Notion.',
    ].join('\n'),
}

async function here($: EngineInterface): Promise<{ cwd: string; branch?: string; iid?: number }> {
  const cwd = await $.session.cwd()
  const branch = (await gitStatus($, cwd))?.branch
  if (!mrs.length) await watchMRs($).catch(() => {})
  return { cwd, branch, iid: mrs.find(m => m.mr.branch === branch)?.mr.iid }
}

// A command whose hook fails says why, instead of « no command.run hook answered it ».
const failed = (_$: EngineInterface, e: { command: string }, next: { error: { kind: string; message?: string } }) => ({
  text: `dolmen-ops : /${e.command} a échoué (${next.error.kind}${next.error.message ? ` : ${next.error.message}` : ''}).`,
})

// The panel's « Ticket suivant »: a toast with the next ticket of the DEW and the command to take it.
async function showNext($: EngineInterface): Promise<void> {
  const next = dew?.[0]
  $.ui.toast(next ? `Prochain : ${next.id} ${next.title} (${next.priority}, ${next.complexity}). Tape /ticket ${next.id}` : 'Aucun ticket Ready dans ton DEW.')
}

// --- lots and their agents -------------------------------------------------------------------------

// Each lot opened from the Lead session gets its own agent, started in the lot's worktree; the Lead
// sends it the lot's commands and its MR's events. Kept across reloads: branch → agentId.
async function lotAgents($: EngineInterface): Promise<Record<string, string>> {
  return ((await $.store.get('lotAgents')) as Record<string, string> | undefined) ?? {}
}

const AGENT_STATE: Record<string, string> = { pending: 'démarre', running: 'travaille', waiting: 'attend', idle: 'attend ta réponse', completed: 'a fini son tour', failed: 'en échec', killed: 'arrêté' }

// Each lot with its agent, its branch, its MR and how long since it moved (its MR, else its last
// commit): past a day, orange with Reprendre. Then what /menage go would remove.
async function lotRows($: EngineInterface, t: number): Promise<PanelRow[]> {
  if (!root) return []
  const agents = await lotAgents($)
  const list = await $.agent.list().catch(() => [])
  const rows: PanelRow[] = []
  for (const lot of await lotDirs($, root)) {
    const s = await gitStatus($, lot.dir)
    const mr = mrs.find(m => m.mr.branch === lot.name)
    const agent = list.find(a => a.id === agents[lot.name])
    const own = await mineToAct($, lot.name)
    const movedAt = mr ? Date.parse(mr.mr.updatedAt) : await lastCommitAt($, lot.dir)
    const age = movedAt ? t - movedAt : undefined
    const parts = [
      !own ? 'autre session' : agent ? `agent : ${AGENT_STATE[agent.status] ?? agent.status}` : agents[lot.name] ? 'agent fermé' : 'pas d\'agent (/plan)',
      !s ? '' : s.upstream !== `origin/${lot.name}` ? (s.ahead || s.dirty ? 'pas encore poussée' : '') : s.ahead ? `${s.ahead} commits locaux` : '',
      mr ? `!${mr.mr.iid}${mr.d ? ` ${mrValue(mr.d).value}` : ''}` : '',
      age !== undefined ? `bougé il y a ${ago(age)}` : '',
    ].filter(Boolean)
    const stale = age !== undefined && age >= STALE_MS && !(mr?.d && wakingEvents(mr.d).length)
    const tone = mr?.d ? mrValue(mr.d).tone : agent?.status === 'idle' || stale ? 'warning' : undefined
    rows.push({ label: lot.name, href: mr?.mr.url, value: parts.join(' · '), tone: stale && tone === 'success' ? 'warning' : tone, ...(stale && own ? { action: { id: `resume:${lot.name}`, label: 'Reprendre' } } : {}) })
  }
  if (menage?.done.length && !lotBranch) {
    const n = menage.done.length
    rows.push({ label: 'À nettoyer', value: `${n} worktree${n > 1 ? 's' : ''} déjà dans main`, action: { id: 'menage', label: 'Nettoyer', confirm: `Supprimer ${n} worktree${n > 1 ? 's' : ''} mergé${n > 1 ? 's' : ''} et leur branche locale ?` } })
  }
  return rows.length ? rows : [{ label: '—', value: 'aucun lot ouvert (/ticket ET-…)', tone: 'subtle' }]
}

// The lot a command names: this session's own, else the one whose branch holds the ET id given,
// else the only one open.
async function lotFor($: EngineInterface, args: string): Promise<{ name: string; dir: string } | string> {
  if (!root) return 'Pas dans Dolmen.'
  const lots = await lotDirs($, root)
  const id = ticketIds(args)[0]
  const lot = id ? lots.find(l => ticketIds(l.name).includes(id)) : lots.length === 1 ? lots[0] : undefined
  if (lot) return lot
  return lots.length ? `Quel lot ? Ajoute son ticket, par exemple /plan ${ticketIds(lots[0]!.name)[0]} (ouverts : ${lots.map(l => ticketIds(l.name).join('+')).join(', ')}).` : 'Aucun lot ouvert : /ticket ET-… d\'abord.'
}

const lotBrief = (name: string, dir: string) =>
  [
    `Tu es l'agent du lot ${name} (tickets ${ticketIds(name).join(', ')}). Tu travailles uniquement dans ${dir}, sa branche et son worktree.`,
    'Lis les tickets avec ticket_card. Tu ne merges pas, n\'approuves pas, ne sors pas du Draft, ne résous aucun fil : ces gestes sont à Younes.',
    'Quand tu as besoin de lui, finis ton tour par la question. Ses messages et les événements de la MR t\'arrivent ici.',
  ].join('\n')

// A lot's command: in the lot's own session, to the model; from the Lead, to the lot's agent,
// started in the worktree when it has none yet.
async function toLot($: EngineInterface, args: string, text: string): Promise<string> {
  if (lotBranch) {
    handOff($, text)
    return 'La demande part à l\'agent.'
  }
  const lot = await lotFor($, args)
  if (typeof lot === 'string') return lot
  const agents = await lotAgents($)
  const known = agents[lot.name]
  if (known) {
    const sent = await $.session.send({ to: { agentId: known }, text }).catch(() => ({ isDelivered: false as const }))
    if (sent.isDelivered) return `→ agent du lot ${lot.name}.`
  }
  $.clock.after(1, () => void startLotAgent($, lot.name, lot.dir, text))
  return `Agent du lot ${lot.name} démarré dans son worktree. Il apparaît dans tes agents et dans « Lots en cours ».`
}

async function startLotAgent($: EngineInterface, name: string, dir: string, text: string): Promise<void> {
  const r = await $.agent.spawn({ prompt: `${lotBrief(name, dir)}\n\n${text}`, description: `Lot ${ticketIds(name).join('+')}`, cwd: dir })
  if (!('agentId' in r) || !r.agentId) {
    $.ui.toast(`L'agent du lot ${name} n'a pas démarré${'deny' in r ? ` : ${r.deny}` : ''}`)
    return
  }
  await $.store.set('lotAgents', { ...(await lotAgents($)), [name]: r.agentId })
}

// --- commands -----------------------------------------------------------------------------------

async function cmdPrompt($: EngineInterface, name: 'plan' | 'mr' | 'note', e: CommandRunInput): Promise<CommandRunResult> {
  return { text: `/${name} : ${await toLot($, e.args ?? '', PROMPTS[name])}` }
}

async function cmdTicket($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  if (!root) return { text: 'Pas dans Dolmen.' }
  const ids = ticketIds((e.args ?? ""))
  if (!ids.length) {
    const next = dew?.[0] ?? (await dewList($, root))?.[0]
    return { text: next ? `Prochain ticket de ton DEW : ${next.id} ${next.title} (${next.priority}, ${next.complexity}). Tape /ticket ${next.id}.` : 'Aucun ticket Ready dans ton DEW.' }
  }
  return { text: (await lotOpen($, root, ids, /\bforce\b/.test((e.args ?? "")))).text }
}

async function cmdAjouter($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  const id = ticketIds((e.args ?? ""))[0]
  if (!root || !id) return { text: 'Usage : /ajouter ET-4481' }
  return { text: await lotAdd($, root, await $.session.cwd(), id, /\bforce\b/.test((e.args ?? ""))) }
}

async function cmdDetacher($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  const id = ticketIds((e.args ?? ""))[0]
  if (!id) return { text: 'Usage : /detacher ET-4481' }
  return { text: await toLot($, e.args ?? '', PROMPTS.detacher(id)) }
}

// Leaving Draft is the author's call: only a /pret typed by Younes, or his press on « Prête », allows
// it, for that MR, for 2 h (kept in $.state, so a reload does not take it back).
async function pretFor($: EngineInterface, iid: number, args: string): Promise<string> {
  if (!root) return 'Pas dans Dolmen.'
  const d = await digest($, root, mrwatch, iid)
  if (d && (d.pipeline === 'failed' || d.failed.length || d.conflicts)) return `!${iid} n'est pas prête : ${mrValue(d).value}. Le babysit d'abord.`
  const until = (await now($)) + READY_TTL_MS
  await update($, readyAtom, r => ({ ...r, [String(iid)]: until }))
  return `!${iid} : verify, recette, qa-will, puis sortie de Draft si tout est ✅. ${await toLot($, args, PROMPTS.pret(iid))}`
}

async function cmdPret($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  if (e.origin.kind !== 'composer') return { text: '/pret ne s’exécute que tapé par toi.' }
  const args = e.args ?? ''
  const lot = lotBranch ? undefined : await lotFor($, args)
  const lotMr = typeof lot === 'object' ? mrs.find(m => m.mr.branch === lot.name)?.mr.iid : undefined
  const iid = Number(/\d+/.exec(args.replace(/\bET[-_]\d+/gi, ''))?.[0]) || lotMr || (await here($)).iid
  if (!iid || !root) return { text: 'Aucune MR pour cette branche. Usage : /pret 2961' }
  return { text: await pretFor($, iid, args) }
}

async function cmdRelire($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  const iid = /\d+/.exec((e.args ?? ""))?.[0] ?? (reviews[0] ? String(reviews[0].iid) : undefined)
  if (!iid) return { text: 'Rien à relire. Usage : /relire 2958' }
  handOff($, PROMPTS.relire(iid))
  return { text: `!${iid} : relecture préparée, rien ne sera posté sans ton OK.` }
}

async function cmdEpic($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  if (!(e.args ?? "").trim()) return { text: 'Usage : /epic <lien Notion de l\'epic>' }
  handOff($, PROMPTS.epic((e.args ?? "").trim()))
  return { text: 'Découpage de l\'epic demandé à l\'agent. Rien n\'est créé dans Notion sans ton OK.' }
}

async function cmdBugs($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  $.clock.after(1, () => void warm($))
  if (!bugs) return { text: LOADING }
  const t = await now($)
  const rows = await bugRows($, t)
  const lead = scopes.filter(s => s.role === 'Lead').map(s => s.name)
  return { text: [`Bugs ouverts de tes scopes${lead.length ? ` (Lead : ${lead.join(', ')})` : ''}, en jours ouvrés contre le SLO :`, ...rows.map(r => `  ${r.label} : ${r.value}`)].join('\n') }
}

async function cmdEtat($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  return { text: (await report($)) ?? LOADING }
}

async function cmdMenage($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  if (!root) return { text: 'Pas dans Dolmen.' }
  const s = await sweep($, root)
  const lines = [...s.done.map(l => `mergé, propre : ${l.name}`), ...s.dirty.map(n => `mergé mais modifié (gardé) : ${n}`)]
  if ((e.args ?? "").trim() !== 'go') return { text: lines.length ? [...lines, '', s.done.length ? 'Tape « /menage go » pour les supprimer (worktree et branche locale, jamais forcé).' : ''].join('\n') : 'Rien à nettoyer.' }
  if (e.origin.kind !== 'composer') return { text: '/menage go ne s’exécute que tapé par toi.' }
  const done = (await sweepApply($, root, s)).join('\n') || 'Rien à nettoyer.'
  await changed($, ['menage'])
  return { text: done }
}

async function cmdPanneau($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  panelOn = true
  await $.ui.open({ id: PANE, title: 'Dolmen', backgroundColor: 'transparent' })
  $.clock.after(1, () => void warm($))
  return { text: 'Panneau Dolmen ouvert : MR toutes les 2 min, relectures toutes les 10 min, Notion toutes les heures, lus une fois pour toutes les sessions de ce Mac (~/.cache/dolmen-ops).' }
}

// --- the pane's buttons -------------------------------------------------------------------------
// A Button is pressed by a person, never by a model: a press is Younes's gesture, as if typed. The ones
// that write (Prendre: a Notion claim; Prête; Nettoyer) ask « Oui / Non » first. Nothing is posted on
// GitLab without his OK: the agents' own rules say so, the buttons only start them.

const RESUME =
  'Ce lot n\'a pas bougé depuis plus d\'un jour. Relis la section « État » de sa MR (ou ses derniers commits), puis reprends-le, ou dis à Younes en deux lignes ce qui le bloque.'

async function act($: EngineInterface, id: string): Promise<void> {
  const [kind, arg = ''] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)]
  switch (kind) {
    case 'treat': {
      const m = mrs.find(x => String(x.mr.iid) === arg)
      if (!m?.d) return void $.ui.toast(`!${arg} : pas de digest mrwatch pour l'instant.`)
      const text = babysitPrompt(m.mr.iid, m.mr.title, m.d)
      if (lotBranch) return handOff($, text)
      return void $.ui.toast(await toLot($, ticketIds(m.mr.branch).join(' '), text))
    }
    case 'ready':
      return void $.ui.toast(await pretFor($, Number(arg), ''))
    case 'review':
      return handOff($, PROMPTS.relire(arg))
    case 'take': {
      if (!root) return
      const opened = await lotOpen($, root, [arg])
      $.ui.toast(opened.text.split('\n')[0]!)
      await changed($, ['dew', 'notion', 'menage'])
      return
    }
    case 'resume':
      return void $.ui.toast(await toLot($, ticketIds(arg).join(' '), RESUME))
    case 'menage': {
      if (!root) return
      const done = await sweepApply($, root, await sweep($, root))
      $.ui.toast(done.length ? `Nettoyé : ${done.join(' · ')}` : 'Rien à nettoyer.')
      await changed($, ['menage'])
      return
    }
  }
}

async function press($: EngineInterface, a: PanelAction): Promise<void> {
  if (!a.confirm) return act($, a.id)
  const at = await now($)
  await update($, armed, () => ({ id: a.id, at }))
  $.clock.after(CONFIRM_MS, () => void disarm($, a.id, at))
}

async function disarm($: EngineInterface, id?: string, at?: number): Promise<void> {
  await update($, armed, cur => (!id || (cur?.id === id && cur.at === at) ? null : cur))
}

async function confirmed($: EngineInterface, id: string): Promise<void> {
  await disarm($)
  await act($, id)
}

// --- registration ---------------------------------------------------------------------------------

const COMMANDS: [string, string][] = [
  ['ticket', 'Dolmen : prend un ou plusieurs tickets (ET-…) et ouvre leur lot : claim Notion, branche, worktree'],
  ['ajouter', 'Dolmen : ajoute un ticket (ET-…) au lot de ce worktree'],
  ['detacher', 'Dolmen : sort un ticket (ET-…) de ce lot vers sa propre branche'],
  ['plan', 'Dolmen : grill + contrôles readiness + test plan du lot'],
  ['mr', 'Dolmen : ouvre la MR Draft du lot (open-mr-empowill)'],
  ['pret', 'Dolmen : verify, recette, qa-will, puis sortie de Draft (tapé par toi)'],
  ['note', 'Dolmen : met à jour la section État de la MR'],
  ['relire', 'Dolmen : relit une MR d\'un collègue (review-mr-empowill), sans rien poster'],
  ['epic', 'Dolmen : propose le découpage d\'une epic en tickets ≤ Medium'],
  ['bugs', 'Dolmen : les bugs de tes scopes, classés par SLO'],
  ['etat', 'Dolmen : MR, relectures, bugs, DEW, coût du lot, quota'],
  ['panneau', 'Dolmen : ouvre le panneau'],
  ['menage', 'Dolmen : les worktrees de lots déjà mergés. /menage go les supprime (worktree et branche locale)'],
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = await dolmenRoot($, e.cwd).catch(() => undefined)
    if (!root) return next(e) // not a Dolmen session: the mod stays quiet
    const branch = (await gitStatus($, e.cwd).catch(() => undefined))?.branch
    lotBranch = branch && ticketIds(branch).length ? branch : undefined
    $.clock.after(1, () => void warm($))
    await ensureTicker($)
    for (const [name, description] of COMMANDS) await $.command.register({ name, description }).catch(() => {})
    await $.tool
      .register({
        name: 'ticket_card',
        isDeferred: false,
        description: 'Dolmen: a Notion ticket as a compact card (title, type, priority, complexity, status, epic, Plan, page text capped at 6000 chars). Use it instead of fetching the Notion page.',
        inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'ET-XXXX' } }, required: ['id'] },
      })
      .catch(() => {})
    await $.agent
      .register({
        name: 'runner',
        description: 'Runs one Dolmen check (task test-pkg, task lint, task recette, a CI job log) and reports it in a few lines. Cheap model: use it for anything that only runs and reads.',
        model: 'haiku',
        tools: ['Bash', 'Read', 'Grep'],
        prompt: [
          'You run one Dolmen command and report it. Do not change code, commit or post anything.',
          'Use the repo\'s tasks (task test-pkg PKG=…, task lint, task recette …), never raw go test.',
          'Report: the command, pass/fail, each failing test or criterion with its first error line, and the log path dolmen-ops printed.',
          'For a recette, read the verdict per criterion as text; open a capture only for a ❌.',
        ].join('\n'),
      })
      .catch(() => {})
    return next(e)
  })

  on('tool.call', { tool: 'mcp__dolmen-ops__ticket_card' }, async ($, e) => {
    if (!root) return { deny: 'Not in a Dolmen checkout.' }
    const id = ticketIds(String(e.id ?? ''))[0]
    if (!id) return { deny: 'ticket_card needs an id like ET-4236.' }
    const c = await findTicket($, root, id, true)
    return c ? { result: cardText(c) } : { deny: `${id}: not found in Notion (NOTION_TOKEN in ~/.dolmen/.envprivate?).` }
  })

  // One hook serves every command. With one matcher hook per command, a live session answered only
  // /panneau, the module's last one; /etat and /ticket went unanswered (the tests did not show it).
  on('command.run', async ($, e, next) => {
    // Outside Dolmen the same names may be another mod's (seammo-ops has /panneau, /etat, /menage).
    if (!root) return next(e)
    switch (e.command.replace(/^dolmen-ops:/, '')) {
      case 'plan':
        return cmdPrompt($, 'plan', e)
      case 'mr':
        return cmdPrompt($, 'mr', e)
      case 'note':
        return cmdPrompt($, 'note', e)
      case 'ticket':
        return cmdTicket($, e)
      case 'ajouter':
        return cmdAjouter($, e)
      case 'detacher':
        return cmdDetacher($, e)
      case 'pret':
        return cmdPret($, e)
      case 'relire':
        return cmdRelire($, e)
      case 'epic':
        return cmdEpic($, e)
      case 'bugs':
        return cmdBugs($, e)
      case 'etat':
        return cmdEtat($, e)
      case 'menage':
        return cmdMenage($, e)
      case 'panneau':
        return cmdPanneau($, e)
      default:
        return next(e)
    }
  }).catch(($, e, next) => (next.called ? next(e) : failed($, e, next)))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    panelOn = true // a pane still open after a reload keeps refreshing
    const s = await read($, snapshot)
    const waiting = await read($, armed)
    void ensureTicker($)
    // An empty snapshot after a /clear or a reload: redraw from what is in memory, then read anew.
    if (s.at === 0) $.clock.after(1, () => void warm($))
    const width = Math.max(20, e.props.bodyColumns)
    const section = (title: string, rows: PanelRow[]) => (
      <Box flexDirection="column" marginBottom={1} width={width}>
        <Text>
          <Text color={EF.bg} backgroundColor={EF.green} bold>
            {` ${title} `}
          </Text>
          <Text color={EF.green}>{ARROW}</Text>
        </Text>
        {rows.map(r => {
          const a = r.action
          // An action pressed once that asks twice: its question and « Oui / Non » in place of the value.
          const asking = !!a && waiting?.id === a.id
          const shown = asking ? (a.confirm ?? '') : r.value
          const buttons = a ? (asking ? [<Button key={`yes:${a.id}`} label="Oui" variant="primary" onPress={() => void confirmed($, a.id)} />, <Button key={`no:${a.id}`} label="Non" onPress={() => void disarm($)} />] : [<Button key={`act:${a.id}`} label={a.label} variant="primary" onPress={() => void press($, a)} />]) : []
          // The terminal draws a Button as `[ label ]`: without room on the row it goes on the next line.
          const inline = r.label.length + shown.length + (a ? (asking ? 14 : a.label.length + 5) : 0) + 2 <= width
          const line = (
            <Box flexDirection="row" justifyContent="space-between" width={width}>
              <Box flexShrink={1} marginRight={1}>
                <Text wrap="truncate-end" color={r.tone === 'subtle' ? EF.grey : EF.fg}>
                  {r.href ? <Link href={r.href}>{r.label}</Link> : r.label}
                </Text>
              </Box>
              <Box flexShrink={0} flexDirection="row" gap={1}>
                <Text color={asking ? EF.yellow : r.tone ? TONE[r.tone] : EF.fg} bold={asking || r.tone === 'error'}>
                  {shown}
                </Text>
                {inline && buttons}
              </Box>
            </Box>
          )
          if (inline || !buttons.length) return line
          return (
            <Box flexDirection="column" width={width}>
              {line}
              <Box flexDirection="row" justifyContent="flex-end" gap={1} width={width}>
                {buttons}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
    const t = await now($)
    return (
      <Box flexDirection="column">
        {s.at === 0 && <Text color={EF.grey}>Chargement…</Text>}
        {s.at > 0 && section('LOTS EN COURS', s.lots)}
        {s.at > 0 && section('MES MR', s.mrs)}
        {s.at > 0 && section('À RELIRE', s.reviews)}
        {s.at > 0 && section('BUGS DE MES SCOPES', s.bugs)}
        {s.at > 0 && section('MON DEW', s.dew)}
        {s.at > 0 && section('SESSION', s.session)}
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="Rafraîchir" onPress={() => void warm($, true)} />
          <Button key="next" label="Ticket suivant" onPress={() => void showNext($)} />
          <Button key="note" label="Note d'état sur la MR" onPress={() => void toLot($, '', PROMPTS.note)} />
        </Box>
        {s.at > 0 && <Text color={EF.grey}>{`mis à jour il y a ${ago(t - s.at)}`}</Text>}
      </Box>
    )
  })

  // The guards: a refusal is the answer when the hook itself fails.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!root) return next(e)
    const t = await now($)
    const ready = await read($, readyAtom).catch(() => ({}) as Record<string, number>)
    const why = refusal(e.command, mr => (ready[mr] ?? 0) > t)
    if (why) return { deny: why }
    for (const dir of amendIn(e.command)) {
      const pushed = await sh($, ['git', 'branch', '-r', '--contains', 'HEAD'], dir)
      if (pushed.ok && pushed.out) return { deny: AMEND_REFUSAL }
    }
    return next(shouldTrim(e.command, e.run_in_background) ? { ...e, command: wrapForTrim(e.command) } : e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'dolmen-ops: the guard failed; run the command again.' }))

  // The cost of each lot: what each turn cost, put on the lot of the session's branch.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!root) return done
    const usd = (await $.session.usage()).cost?.usd
    if (usd === undefined) return done
    const last = await read($, usdAtom).catch(() => -1)
    const spent = last < 0 ? 0 : Math.max(0, usd - last)
    await update($, usdAtom, () => usd).catch(() => {})
    const branch = (await gitStatus($, await $.session.cwd()))?.branch
    if (spent && branch && ticketIds(branch).length) {
      const cost = ((await $.store.get('cost')) as Record<string, number> | undefined) ?? {}
      cost[branch] = (cost[branch] ?? 0) + spent
      await $.store.set('cost', cost)
    }
    return done
  })

  // A /clear starts a new conversation and an empty panel state; the reads in memory still hold.
  on('session.end', ($, e, next) => {
    if (root && e.reason === 'clear') {
      lastTick = 0
      $.clock.after(1, () => void (ensureTicker($), panelOn && refreshPanel($)))
    }
    return next(e)
  })

  on('session.measure', ($, e, next) => {
    const high = highLimits(e.rateLimits)
    quotaHigh = high.length > 0
    for (const h of high) {
      if (warned.has(h.key)) continue
      warned.add(h.key)
      $.ui.toast(`Quota ${h.text} : écris l'État de la MR`)
      void $.ui.notify(`Quota ${h.text}. La session peut s'arrêter sans prévenir : pousse une fois et mets l'État de la MR à jour.`, { title: TITLE })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!root) return composed
    void ensureTicker($)
    const extra = [{ id: 'dolmen-ops:models', text: MODELS_SECTION, scope: 'session' as const }]
    if (quotaHigh) extra.push({ id: 'dolmen-ops:handoff', text: HANDOFF_SECTION, scope: 'session' as const })
    return { sections: [...composed.sections, ...extra] }
  })
}
