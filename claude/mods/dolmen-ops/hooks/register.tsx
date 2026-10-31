// dolmen-ops: the code watches, the model decides. Opens a ticket or a lot of tickets from Notion
// into a branch and its worktree, watches Younes's MRs with mrwatch and wakes the session on what
// needs an answer (a lot's session for its own MR, the Lead session by notification), keeps the Notion status in step with the MR, ranks the bugs of his
// scopes by SLO, refuses the gestures reserved to the author, trims test output and counts the cost
// of each lot. Every check is code, so it costs no tokens until something happens.
import { atom, read, update } from 'claude-code'
import type { CommandRunInput, CommandRunResult, EngineInterface, Register } from 'claude-code'
import type { PanelRow, PanelSnapshot } from '../types'
import {
  buildMrwatch,
  cardText,
  dewList,
  digest,
  dolmenRoot,
  findTicket,
  gitStatus,
  glabMe,
  lotDirs,
  myBugs,
  myMRs,
  myScopes,
  notionMe,
  pipelineCount,
  reviewMRs,
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
const SLOW_MS = 60 * 60_000 // Notion and the review list: once an hour, the Notion API allowance is small
const READY_TTL_MS = 2 * 3_600_000
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

// Module state: a reload starts it over.
let root: string | undefined
let mrwatch: string[] = ['go', 'run', './.agents/skills/babysit-mr-empowill/mrwatch']
let warming: Promise<void> | undefined
// The lot this session works on (its branch names ET ids), or undefined: the Lead session, on main.
let lotBranch: string | undefined
let panelOn = false
let slowAt = 0
let quotaHigh = false
let lastUsd: number | undefined
const warned = new Set<string>()
const told = new Map<number, string>() // MR → the events last told, so one wake per change
const readyArmed = new Map<string, number>() // MR iid → until when /pret allows leaving Draft
let mrs: { mr: MR; d?: Digest }[] = []
let reviews: MR[] = []
let bugs: Bug[] | undefined
let dew: { id: string; title: string; priority: string; complexity: string; url: string }[] | undefined
let me: string | undefined
let scopes: Scope[] = []

async function now($: EngineInterface) {
  return $.clock.now()
}


// A prompt for the model, submitted once the hook that asks for it has returned: a command's hook
// holds the turn, so a submit from inside it would wait on itself.
function handOff($: EngineInterface, text: string): void {
  $.clock.after(1, () => void $.prompt.submit({ text }))
}

// --- watching -------------------------------------------------------------------------------------

async function watchMRs($: EngineInterface): Promise<void> {
  if (!root) return
  const list = await myMRs($)
  if (!list) return
  const next: typeof mrs = []
  for (const mr of list) {
    const d = await digest($, root, mrwatch, mr.iid)
    next.push({ mr, d })
    await syncStatus($, mr)
    const waking = d ? wakingEvents(d) : []
    const fp = waking.join(' ')
    if (!waking.length || told.get(mr.iid) === fp) continue
    told.set(mr.iid, fp)
    // A lot's session wakes for its own MR only; the Lead session never wakes, it says where to go.
    const agent = (await lotAgents($))[mr.branch]
    if (agent && !lotBranch) await $.session.send({ to: { agentId: agent }, text: babysitPrompt(mr.iid, mr.title, d!) })
    else if (lotBranch === mr.branch) handOff($, babysitPrompt(mr.iid, mr.title, d!))
    else if (!lotBranch) void $.ui.notify(`!${mr.iid} ${fp} → ccw attach ${mr.branch}`, { title: TITLE })
  }
  mrs = next
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

async function watchSlow($: EngineInterface, force = false): Promise<void> {
  const t = await now($)
  if (!root || (!force && t - slowAt < SLOW_MS)) return
  slowAt = t
  me ??= await notionMe($, root)
  if (me && !scopes.length) scopes = await myScopes($, root, me)
  bugs = me ? await myBugs($, root, me, scopes) : undefined
  dew = (await dewList($, root))?.map(d => ({ id: d.id, title: d.title, priority: d.priority, complexity: d.complexity, url: d.url }))
  const user = await glabMe($)
  reviews = user ? ((await reviewMRs($, user)) ?? []) : []
}

// The ticker. A /clear ends the session's timers with it (no session.start follows), so every hook
// that runs after one re-arms it when its last tick is too old.
let lastTick = 0
let stopTicker: (() => void) | undefined

async function ensureTicker($: EngineInterface): Promise<void> {
  if (!root || (await now($)) - lastTick < 2 * TICK_MS) return
  stopTicker?.()
  stopTicker = $.clock.every(TICK_MS, () => void tick($))
  lastTick = await now($)
}

async function tick($: EngineInterface): Promise<void> {
  if (!root) return
  lastTick = await now($)
  await watchMRs($).catch(() => {})
  if (panelOn) {
    await watchSlow($).catch(() => {})
    await refreshPanel($).catch(() => {})
  }
}

// --- the panel and /etat --------------------------------------------------------------------------

function bugRows(t: number): PanelRow[] {
  if (!bugs) return [{ label: 'Notion', value: 'injoignable (NOTION_TOKEN ?)', tone: 'subtle' }]
  if (!bugs.length) return [{ label: '—', value: 'aucun bug ouvert dans tes scopes', tone: 'success' }]
  return sortBugs(bugs, t)
    .slice(0, 8)
    .map(b => {
      const s = slo(b, t)
      const who = b.mine ? 'À TOI' : b.assignees.length ? 'pris' : 'personne'
      return {
        label: `${b.id} ${b.title}`,
        href: b.url,
        value: `${b.priority || 'sans priorité'} · ${s.age} j${s.limit ? ` / ${s.limit} j` : ''} · ${who}`,
        tone: s.late ? 'error' : !b.priority ? 'warning' : b.mine ? 'warning' : 'subtle',
      }
    })
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
  rows.push(lotBranch ? { label: 'Rôle', value: 'session de lot : se réveille sur sa MR', tone: 'success' } : { label: 'Rôle', value: 'session Lead : notifie, ne code pas', tone: 'subtle' })
  for (const l of (await $.session.usage()).rateLimits) {
    rows.push({
      label: `Quota ${WINDOWS[l.kind] ?? l.kind.replace('_', ' ')}`,
      value: `${Math.round(l.percentUsed)} %`,
      tone: l.percentUsed >= 90 ? 'error' : l.percentUsed >= 75 ? 'warning' : 'success',
    })
  }
  return rows
}

async function refreshPanel($: EngineInterface, force = false): Promise<void> {
  if (force) {
    await watchMRs($).catch(() => {})
    await watchSlow($, true).catch(() => {})
  }
  const t = await now($)
  const mrRows: PanelRow[] = mrs.length
    ? mrs.flatMap(({ mr, d }) => {
        const v = d ? mrValue(d) : { value: 'mrwatch injoignable (glab auth status ?)', tone: 'subtle' as const }
        const row: PanelRow = { label: `!${mr.iid} ${mr.tickets.join(' + ') || mr.title}`, href: mr.url, ...v }
        const threads = (d?.threads ?? []).slice(0, 2).map(th => ({ label: `  ${th.author}`, value: th.where || 'fil général', tone: 'subtle' as const }))
        return [row, ...threads]
      })
    : [{ label: '—', value: 'aucune MR ouverte', tone: 'subtle' }]
  const reviewRows: PanelRow[] = reviews.length
    ? reviews.map(r => ({ label: `!${r.iid} ${r.tickets.join(' + ') || r.title} (${r.author})`, href: r.url, value: `demandée · ${ago(t - Date.parse(r.updatedAt))}`, tone: 'warning' }))
    : [{ label: '—', value: 'rien à relire', tone: 'subtle' }]
  const dewRows: PanelRow[] = !dew
    ? [{ label: 'task dew', value: 'injoignable', tone: 'subtle' }]
    : dew.length
      ? dew.slice(0, 6).map(d => ({ label: `${d.id} ${d.title}`, href: d.url, value: `${d.priority} · ${d.complexity}`, tone: d.priority === 'Critical' ? 'error' : undefined }))
      : [{ label: '—', value: 'aucun ticket Ready', tone: 'subtle' }]
  const session = await sessionRows($)
  const lots = await lotRows($)
  await update($, snapshot, () => ({ at: t, lots, mrs: mrRows, reviews: reviewRows, bugs: bugRows(t), dew: dewRows, session }))
}

// Everything slow (go build of mrwatch, `task dew` compiling the dolmen CLI, Notion, glab) runs here,
// in the background: commands answer from what it last read and never wait on it.
function warm($: EngineInterface): Promise<void> {
  warming ??= (async () => {
    if (root && mrwatch[0] === 'go') mrwatch = await buildMrwatch($, root).catch(() => mrwatch)
    await refreshPanel($, true).catch(() => {})
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
      `Sors ${id} de ce lot sans réécrire l'historique poussé : crée la branche ${id}-<slug> depuis origin/main dans le dossier des worktrees de ccw,`,
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

async function lotRows($: EngineInterface): Promise<PanelRow[]> {
  if (!root) return []
  const agents = await lotAgents($)
  const list = await $.agent.list().catch(() => [])
  const rows: PanelRow[] = []
  for (const lot of await lotDirs($, root)) {
    const s = await gitStatus($, lot.dir)
    const mr = mrs.find(m => m.mr.branch === lot.name)
    const agent = list.find(a => a.id === agents[lot.name])
    const parts = [
      agent ? `agent : ${AGENT_STATE[agent.status] ?? agent.status}` : agents[lot.name] ? 'agent fermé' : 'pas d\'agent (/plan)',
      !s ? '' : s.upstream !== `origin/${lot.name}` ? (s.ahead || s.dirty ? 'pas encore poussée' : '') : s.ahead ? `${s.ahead} commits locaux` : '',
      mr ? `!${mr.mr.iid}${mr.d ? ` ${mrValue(mr.d).value}` : ''}` : '',
    ].filter(Boolean)
    rows.push({ label: lot.name, href: mr?.mr.url, value: parts.join(' · '), tone: mr?.d ? mrValue(mr.d).tone : agent?.status === 'idle' ? 'warning' : undefined })
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

// Leaving Draft is the author's call: only a /pret typed by Younes allows it, for that MR, for 2 h.
async function cmdPret($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  if (e.origin.kind !== 'composer') return { text: '/pret ne s’exécute que tapé par toi.' }
  const args = e.args ?? ''
  const lot = lotBranch ? undefined : await lotFor($, args)
  const lotMr = typeof lot === 'object' ? mrs.find(m => m.mr.branch === lot.name)?.mr.iid : undefined
  const iid = Number(/\d+/.exec(args.replace(/\bET[-_]\d+/gi, ''))?.[0]) || lotMr || (await here($)).iid
  if (!iid || !root) return { text: 'Aucune MR pour cette branche. Usage : /pret 2961' }
  const d = await digest($, root, mrwatch, iid)
  if (d && (d.pipeline === 'failed' || d.failed.length || d.conflicts)) {
    return { text: `!${iid} n'est pas prête : ${mrValue(d).value}. Le babysit d'abord.` }
  }
  readyArmed.set(String(iid), (await now($)) + READY_TTL_MS)
  return { text: `!${iid} : verify, recette, qa-will, puis sortie de Draft si tout est ✅. ${await toLot($, args, PROMPTS.pret(iid))}` }
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
  const rows = bugRows(t)
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
  if ((e.args ?? "").trim() !== 'go') return { text: lines.length ? [...lines, '', s.done.length ? 'Tape « /menage go » pour les supprimer (ccw rm).' : ''].join('\n') : 'Rien à nettoyer.' }
  if (e.origin.kind !== 'composer') return { text: '/menage go ne s’exécute que tapé par toi.' }
  return { text: (await sweepApply($, root, s)).join('\n') || 'Rien à nettoyer.' }
}

async function cmdPanneau($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> {
  panelOn = true
  await $.ui.open({ id: PANE, title: 'Dolmen', backgroundColor: 'transparent' })
  $.clock.after(1, () => void warm($))
  return { text: 'Panneau Dolmen ouvert : MR toutes les 2 min, Notion et relectures toutes les heures.' }
}

// --- registration ---------------------------------------------------------------------------------

const COMMANDS: [string, string][] = [
  ['ticket', 'Dolmen : prend un ou plusieurs tickets (ET-…) et ouvre leur lot : claim Notion, branche, worktree ccw'],
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
  ['menage', 'Dolmen : les worktrees de lots déjà mergés. /menage go les supprime (ccw rm)'],
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
    void ensureTicker($)
    // An empty snapshot after a /clear or a reload: redraw from what is in memory, then read anew.
    if (s.at === 0) $.clock.after(1, () => void (mrs.length || bugs || dew ? refreshPanel($) : warm($)))
    const width = Math.max(20, e.props.bodyColumns)
    const section = (title: string, rows: PanelRow[]) => (
      <Box flexDirection="column" marginBottom={1} width={width}>
        <Text>
          <Text color={EF.bg} backgroundColor={EF.green} bold>
            {` ${title} `}
          </Text>
          <Text color={EF.green}>{ARROW}</Text>
        </Text>
        {rows.map(r => (
          <Box flexDirection="row" justifyContent="space-between" width={width}>
            <Box flexShrink={1} marginRight={1}>
              <Text wrap="truncate-end" color={r.tone === 'subtle' ? EF.grey : EF.fg}>
                {r.href ? <Link href={r.href}>{r.label}</Link> : r.label}
              </Text>
            </Box>
            <Box flexShrink={0}>
              <Text color={r.tone ? TONE[r.tone] : EF.fg} bold={r.tone === 'error'}>
                {r.value}
              </Text>
            </Box>
          </Box>
        ))}
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
          <Button key="refresh" label="Rafraîchir" onPress={() => void warm($)} />
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
    const why = refusal(e.command, mr => (readyArmed.get(mr) ?? 0) > t)
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
    const spent = lastUsd === undefined ? 0 : Math.max(0, usd - lastUsd)
    lastUsd = usd
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
