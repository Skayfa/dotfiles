// pilote: the tracking file in code. The file is the truth, the code keeps the gates, the model decides,
// the owner presses the buttons.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Armed, Pilotage, Snapshot, Tache } from '../types'
import {
  FILE, GATE_TIMEOUT_MS, REVIEW_TIMEOUT_MS, ask, coursRows, drop, currentJalon, decide, finish, finishable, frozenEdits, gateArgv,
  gateLine, gateProof, go, jalonCounts, nextRows, note, parse, parseVerdict, reviewPrompt, scopeCounts, serialize, splitPaths, start,
  statusMoves, stalled, summary, suspend, tail, toiRows, wakeText, type GateRun, type Move, type Review, type Row,
} from './rules.ts'

const PANE = 'pilote'
const CONFIRM_MS = 10_000
const TICK_MS = 3_000
const EMPTY: Snapshot = { isFound: false, mtimeMs: 0, readAt: 0, data: null, errors: [] }
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const DIFF_MAX = 80_000

const snap = atom({ plugin: 'pilote', key: 'snap' } as const, EMPTY, { shape: 'snap-1' })
const armed = atom({ plugin: 'pilote', key: 'armed' } as const, null as Armed, { shape: 'armed-1' })

const METHOD = [
  '## Pilotage (mod pilote)',
  `Ce projet est suivi dans \`${FILE}\`, pas dans GitHub. Le code garde les portes, toi tu décides, le propriétaire donne les go.`,
  '- Avant de coder une tâche : `mcp__pilote__tache_demarrer`. Il refuse une tâche qui n’est pas prête (dépendance, question ouverte, jalon sans go, trop de tâches en cours).',
  '- Après chaque étape : `tache_note` (fait / reste / suivant), pour qu’une autre session reprenne sans toi.',
  '- Pas de CI : la preuve se fait en local (commandes du projet). Pour finir : `tache_terminer` avec la preuve et le numéro de chaque critère couvert. Le mod lance lui-même la gate du projet sur les chemins de la tâche et refuse si elle échoue ; pour une tâche qui touche aux données, il lance lui-même le sous-agent de relecture et refuse sans verdict OK. Pas de preuve, pas de fin.',
  '- Une décision qui revient au propriétaire : `question_poser`. Sa réponse : `question_trancher`, avec ses mots. Ne tranche jamais à sa place.',
  '- Le go d’un jalon appartient au propriétaire (`/go <jalon>` ou le bouton du panneau).',
  '- Plusieurs sessions peuvent travailler en parallèle : chaque tâche déclare ses `chemins`, une tâche tenue par une autre session ne se touche pas, et tu n’écris que dans les chemins de ta tâche. Un chemin de plus : `question_poser` ou édite ses `chemins` avant d’y écrire.',
  '- Tu peux enrichir le backlog en éditant le fichier (tâches, critères, questions). Les statuts, les décisions et les go passent par les outils. Une tâche en cours garde ses termes (critères, risque données, invariant, dépendances) jusqu’à sa fin : pour les changer, suspends-la.',
].join('\n')

// One file for every session of the project: the main checkout's, even from a worktree.
let root = ''
let cwd = ''
let session = ''
// This session's life, for the stall check: main turn running, last move of any loop, tasks already told.
let mainRunning = false
let lastActivity = 0
let delegated = false
const woken = new Set<string>()
let wakeSent = ''

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const where = () => (root ? `${root}/${FILE}` : FILE)
const isOurFile = (path: string) => path === where() || ((path === FILE || path === `./${FILE}`) && cwd === root)
const isCopy = (path: string) => !isOurFile(path) && (path === FILE || path === `./${FILE}` || path.endsWith(`/${FILE}`))

// The main checkout: the folder that holds the shared .git, else the session's folder.
async function rootOf($: EngineInterface, dir: string): Promise<string> {
  const r = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: dir }).catch(() => undefined)
  const common = r?.exitCode === 0 ? r.stdout.trim() : ''
  return common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : dir
}

// Reads the file again when it changed on disk (or always, with `force`).
async function refresh($: EngineInterface, force = false): Promise<Snapshot> {
  const cur = await read($, snap)
  const stat = await $.fs.stat(where()).catch(() => undefined)
  if (!stat || stat.kind !== 'file') {
    if (cur.isFound) await update($, snap, () => EMPTY)
    return EMPTY
  }
  if (!force && cur.isFound && cur.mtimeMs === stat.mtimeMs) return cur
  const text = await $.fs.read(where()).catch(() => '')
  const { data, errors } = parse(text)
  const next: Snapshot = { isFound: true, mtimeMs: stat.mtimeMs, readAt: await $.clock.now(), data, errors }
  await update($, snap, () => next)
  return next
}

// Every move reads the file fresh, changes it with a pure rule, and writes it whole only if nobody wrote
// in between: otherwise it applies the move again on what the other session wrote. The window left is
// the one between the last read and the write.
async function apply($: EngineInterface, move: (p: Pilotage, now: number) => Move): Promise<{ result: string } | { deny: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const text = await $.fs.read(where()).catch(() => undefined)
    if (text === undefined) return { deny: `Pas de ${FILE} dans ${root || 'ce dossier'}.` }
    const { data } = parse(text)
    if (!data) return { deny: `${FILE} n’est pas lisible : corrige le JSON d’abord.` }
    const done = move(data, await $.clock.now())
    if ('refus' in done) return { deny: done.refus }
    const latest = await $.fs.read(where()).catch(() => undefined)
    if (latest !== text) continue
    await $.fs.write(where(), serialize(done.file))
    await refresh($, true)
    return { result: done.said }
  }
  return { deny: `${FILE} change sans arrêt (une autre session écrit) : réessaie.` }
}

const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : [])

// --- tache_terminer: the gate and the reviewer, run by the mod ---------------------------------

// A subagent's answer arrives as its turn.complete. Answers that land before their waiter (a fast
// agent) are kept while a review is being spawned.
const answers = new Map<string, string | null>()
const waiters = new Map<string, (answer: string | null) => void>()
let spawning = 0

type Wait = string | null | 'timeout' | 'aborted'

function answerOf($: EngineInterface, agentId: string, signal: AbortSignal): Promise<Wait> {
  if (answers.has(agentId)) {
    const a = answers.get(agentId) ?? null
    answers.delete(agentId)
    return Promise.resolve(a)
  }
  return new Promise(resolve => {
    const done = (a: Wait) => {
      waiters.delete(agentId)
      timer.cancel()
      signal.removeEventListener('abort', onAbort)
      resolve(a)
    }
    const onAbort = () => done('aborted')
    const timer = $.clock.after(REVIEW_TIMEOUT_MS, () => done('timeout'))
    waiters.set(agentId, a => done(a))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// Runs projet.verification in the main checkout, the task's paths in PILOTE_CHEMINS (one per line).
async function runGate($: EngineInterface, cmd: string, t: Tache): Promise<{ run: GateRun } | { deny: string }> {
  const argv = gateArgv(cmd)
  const at = await $.clock.now()
  const env = { PILOTE_CHEMINS: (t.chemins ?? []).join('\n'), PILOTE_TACHE: t.id }
  let res: Awaited<ReturnType<EngineInterface['process']['run']>>
  try {
    res = await $.process.run(argv, { cwd: root || cwd, env, timeoutMs: GATE_TIMEOUT_MS })
  } catch (err) {
    const ms = (await $.clock.now()) - at
    const msg = String(err).slice(0, 300)
    const why = /time(d)?[ -]?out/i.test(msg) || ms >= GATE_TIMEOUT_MS - 1_000
      ? `did not finish within ${GATE_TIMEOUT_MS / 60_000} min (${msg})`
      : `could not run (${msg}): is \`${argv[0]}\` installed and on the PATH?`
    return { deny: `Refused: the gate \`${cmd}\` ${why}. ${t.id} stays in progress.` }
  }
  const run: GateRun = { argv, exitCode: res.exitCode, ms: (await $.clock.now()) - at, stdout: res.stdout, stderr: res.stderr, at }
  if (run.exitCode !== 0)
    return { deny: `Refused: the gate failed. ${gateLine(run)}\n${[tail(res.stdout), tail(res.stderr, 10, 1_000)].filter(Boolean).join('\n')}\nFix it, then call tache_terminer again.` }
  return { run }
}

// Spawns the project's reviewer on the task's diff and reads its verdict from its own answer.
async function runReview($: EngineInterface, agent: string, t: Tache, signal: AbortSignal): Promise<{ review: Review } | { deny: string }> {
  const dir = root || cwd
  const git = async (args: string[]) => {
    const r = await $.process.run(['git', '-c', 'core.quotePath=false', ...args], { cwd: dir, timeoutMs: 60_000 }).catch(() => undefined)
    return r?.exitCode === 0 ? r.stdout : ''
  }
  const { inside, outside } = splitPaths(t.chemins ?? [], dir)
  const base = t.debut ? (await git(['rev-list', '-1', `--before=${t.debut}T00:00:00Z`, 'HEAD'])).trim() : ''
  const spec = inside.length ? ['--', ...inside] : outside.length ? null : []
  let diff = spec ? await git(['diff', base || EMPTY_TREE, ...spec]) : ''
  const untracked = spec ? (await git(['ls-files', '--others', '--exclude-standard', ...spec])).split('\n').filter(Boolean) : []
  if (diff.length > DIFF_MAX) diff = `${diff.slice(0, DIFF_MAX)}\n… cut at ${DIFF_MAX} characters: run \`git diff ${base || EMPTY_TREE} -- ${inside.join(' ')}\` for the rest.`

  // A description of its own, to find the agent in $.agent.list() when the spawn answers no id.
  const description = `review ${t.id} ${await $.clock.now()}`
  spawning++
  try {
    const spawned = await $.agent
      .spawn({ prompt: reviewPrompt(t, diff, base, untracked, outside), subagentType: agent, description })
      .catch((err: unknown) => ({ deny: String(err).slice(0, 300) }))
    if (spawned.deny) return { deny: `Refused: the reviewer \`${agent}\` could not start (${spawned.deny}). ${t.id} stays in progress.` }
    const agentId = ('agentId' in spawned && spawned.agentId) || (await $.agent.list().catch(() => [])).filter(a => a.description === description).at(-1)?.id
    if (!agentId) return { deny: `Refused: the reviewer \`${agent}\` started with no agent id to wait for. ${t.id} stays in progress.` }
    const answer = await answerOf($, agentId, signal)
    if (answer === 'timeout') return { deny: `Refused: the reviewer \`${agent}\` gave no answer within ${REVIEW_TIMEOUT_MS / 60_000} min.` }
    if (answer === 'aborted') return { deny: `Refused: interrupted while the reviewer \`${agent}\` was running.` }
    if (answer === null) return { deny: `Refused: the reviewer \`${agent}\` ended without an answer (interrupted, refused or an API error).` }
    const verdict = parseVerdict(answer)
    if (!verdict) return { deny: `Refused: the reviewer's answer has no \`verdict: OK|A_CORRIGER|BLOQUANT\` line.\n${tail(answer, 20, 2_000)}` }
    if (verdict !== 'OK') return { deny: `Refused: review ${verdict}. Fix what it reports, then call tache_terminer again.\n${tail(answer, 40, 3_000)}` }
    return { review: { verdict, texte: `${agent}, agent ${agentId}` } }
  } finally {
    spawning--
  }
}

// The cheap refusals first, then the gate, then the reviewer, then the move on a fresh read.
async function terminer($: EngineInterface, e: Record<string, unknown>, signal: AbortSignal): Promise<{ result: string } | { deny: string }> {
  const id = str(e.id)
  const preuve = str(e.preuve)
  const covered = (Array.isArray(e.criteres_couverts) ? e.criteres_couverts : []).map(Number)
  const text = await $.fs.read(where()).catch(() => undefined)
  if (text === undefined) return { deny: `Pas de ${FILE} dans ${root || 'ce dossier'}.` }
  const { data } = parse(text)
  if (!data) return { deny: `${FILE} n’est pas lisible : corrige le JSON d’abord.` }
  const can = finishable(data, id, preuve, covered, session)
  if ('refus' in can) return { deny: can.refus }
  const t = can.task
  const said: string[] = []

  let proof = preuve
  if (data.projet.verification) {
    const g = await runGate($, data.projet.verification, t)
    if ('deny' in g) return g
    proof = gateProof(preuve, g.run)
    said.push(gateLine(g.run))
  } else said.push('No projet.verification in the file: the proof is declared, no gate checked it.')

  let review: Review = { verdict: str(e.relecture_verdict), texte: str(e.relecture) }
  if (t.risque_donnees) {
    if (data.projet.relecteur) {
      const r = await runReview($, data.projet.relecteur, t, signal)
      if ('deny' in r) return r
      review = r.review
      said.push(`review: ${review.verdict} (${review.texte})`)
    } else said.push('No projet.relecteur in the file: the review verdict is declared, no reviewer was run.')
  }
  const r = await apply($, (p, now) => finish(p, id, proof, covered, now, review, session))
  return 'deny' in r ? r : { result: `${r.result}\n${said.join('\n')}` }
}

// --- buttons -----------------------------------------------------------------------------------

async function act($: EngineInterface, id: string): Promise<void> {
  const [kind, arg = ''] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)]
  const submit = (text: string) => void $.prompt.submit({ text })
  switch (kind) {
    case 'answer':
      return submit(`Pose-moi la question ${arg} du pilotage avec ses options et ce qu’elle bloque, attends ma réponse, puis enregistre-la avec question_trancher en citant mes mots.`)
    case 'start':
      return submit(`Démarre ${arg} : tache_demarrer, puis cadre-la (skill grill) contre le code et les docs avant d’écrire quoi que ce soit.`)
    case 'resume':
      return submit(`${arg} n’a pas bougé depuis plus d’un jour : relis sa dernière note et reprends-la, ou dis-moi ce qui la bloque (tache_suspendre si elle doit attendre).`)
    case 'go': {
      const r = await apply($, (p, now) => go(p, arg, now))
      $.ui.toast('deny' in r ? r.deny : r.result)
      return
    }
    case 'refresh':
      await refresh($, true)
  }
}

async function press($: EngineInterface, a: NonNullable<Row['action']>): Promise<void> {
  if (!a.confirm) return act($, a.id)
  const at = await $.clock.now()
  await update($, armed, () => ({ id: a.id, at }))
  $.clock.after(CONFIRM_MS, () => void update($, armed, cur => (cur?.id === a.id && cur.at === at ? null : cur)))
}

// --- a held task nothing works on: wake the session once -----------------------------------------

async function checkStall($: EngineInterface, p: Pilotage): Promise<void> {
  if (!session || !lastActivity) return
  if (mainRunning) {
    // A turn runs: only note whether it has delegated.
    if (!delegated && (await $.agent.list().catch(() => [])).some(a => a.status === 'running')) delegated = true
    return
  }
  const now = await $.clock.now()
  const agents = await $.agent.list().catch(() => [])
  const busy = agents.some(a => a.status === 'running')
  if (busy) delegated = true
  const ts = stalled(p, session, { busy, lastActivity, delegated }, now, woken)
  if (!ts.length) return
  for (const t of ts) woken.add(t.id)
  $.ui.toast(`${ts.map(t => t.id).join(', ')} : rien ne tourne, session relancée`)
  wakeSent = wakeText(ts, Math.round((now - lastActivity) / 60_000))
  void $.prompt.submit({ text: wakeSent })
}

// --- registration ------------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    root = await rootOf($, e.cwd)
    session = await $.session.id().catch(() => '')
    await $.command.register({ name: 'pilotage', description: 'Ouvre le panneau de pilotage et résume le projet' })
    await $.command.register({ name: 'go', description: 'Donne le go d’un jalon (tapé par toi seulement)', argumentHint: '<jalon>' })
    await registerTools($)
    lastActivity = await $.clock.now()
    $.clock.every(TICK_MS, () => void refresh($).then(s => (s.data ? checkStall($, s.data) : undefined)).catch(() => {}))
    const s = await refresh($, true)
    if (s.isFound) void $.ui.open({ id: PANE, title: `Pilotage · ${s.data?.projet.nom ?? ''}` })
    return next(e)
  })

  on('command.run', { command: 'pilotage' }, async $ => {
    const s = await refresh($, true)
    if (!s.isFound) return { text: `Pas de ${FILE} dans ce dossier : le pilotage commence quand ce fichier existe.` }
    await $.ui.open({ id: PANE, title: `Pilotage · ${s.data?.projet.nom ?? ''}` })
    return { text: s.data ? summary(s.data, await $.clock.now()) : `${FILE} illisible : ${s.errors.join(' ; ')}` }
  })

  // A go is the owner's: typed by the owner, never sent by a model or a plugin.
  on('command.run', { command: 'go' }, async ($, e) => {
    if (e.origin.kind !== 'composer') return { text: 'Le go se tape à la main, ou se donne avec le bouton du panneau.' }
    const id = e.args.trim().split(/\s+/)[0]?.toUpperCase()
    if (!id) return { text: 'Usage : /go <jalon>, par exemple /go M1.' }
    const r = await apply($, (p, now) => go(p, id, now))
    return { text: 'deny' in r ? r.deny : r.result }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const s = await read($, snap)
    if (!s.isFound) return composed
    return { sections: [...composed.sections, { id: 'pilote:methode', text: METHOD, scope: 'session' as const }] }
  })

  // Status fields move only through the tools: an Edit or a Write that changes one is refused, and so is one
  // that would leave the file unreadable. The rest of the backlog stays free to edit. Fails open.
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const path = str((e as { file_path?: unknown }).file_path)
    if (isCopy(path)) return { deny: `Ce ${FILE} est une copie (worktree) : le pilotage vit dans ${where()}, et passe par les outils pilote.` }
    if (!isOurFile(path)) return next(e)
    const before = await $.fs.read(where()).catch(() => undefined)
    if (before === undefined) return next(e)
    let after: string
    if (e.tool === 'Write') after = str((e as { content?: unknown }).content)
    else {
      const { old_string: o, new_string: n, replace_all: all } = e as { old_string?: unknown; new_string?: unknown; replace_all?: unknown }
      after = all ? before.split(str(o)).join(str(n)) : before.replace(str(o), () => str(n))
    }
    const was = parse(before).data
    const is = parse(after)
    if (!is.data) return { deny: `Cette modification laisserait ${FILE} illisible : ${is.errors[0]}` }
    const moved = was ? statusMoves(was, is.data) : []
    if (moved.length) return { deny: `Les statuts passent par les outils pilote (tache_demarrer, tache_terminer, tache_abandonner, question_trancher, /go), pas par une édition : ${moved.join(', ')}.` }
    const frozen = was ? frozenEdits(was, is.data) : []
    if (frozen.length)
      return { deny: `Refused: this edit changes ${frozen.join(', ')}. A task in progress keeps its terms until it ends (tache_suspendre first, then edit it); the gate, the reviewer and the journal's moves are not edited by the model.` }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__pilote__tache_demarrer' }, async ($, e) => apply($, (p, now) => start(p, str(e.id), now, session, e.reprendre === true)))
  on('tool.call', { tool: 'mcp__pilote__tache_note' }, async ($, e) =>
    apply($, (p, now) => note(p, str(e.id), { fait: str(e.fait), reste: str(e.reste), suivant: str(e.suivant) }, now, session)))
  on('tool.call', { tool: 'mcp__pilote__tache_terminer' }, async ($, e, next) => terminer($, e as Record<string, unknown>, next.signal))

  // Someone wrote (the owner, a peer): a new start for the stall check. The wake's own prompt is not.
  on('prompt.submit', ($, e, next) => {
    if (!e.isMeta && e.text !== wakeSent) {
      woken.clear()
      delegated = false
    }
    return next(e)
  })

  // Life of the session, for the stall check: any loop's turn is a move; the main loop's says if it runs.
  on('turn.start', async ($, e, next) => {
    lastActivity = await $.clock.now()
    if (e.agentId === undefined) mainRunning = true
    return next(e)
  })

  // A subagent's answer: what a review spawned by tache_terminer waits for.
  on('turn.complete', async ($, e, next) => {
    lastActivity = await $.clock.now()
    if (e.agentId === undefined) mainRunning = false
    const id = e.agentId
    if (id) {
      const answer = e.reason === 'answer' ? e.answer : null
      const waiter = waiters.get(id)
      if (waiter) waiter(answer)
      else if (spawning > 0) {
        answers.set(id, answer)
        if (answers.size > 20) answers.delete(answers.keys().next().value as string)
      }
    }
    return next(e)
  })
  on('tool.call', { tool: 'mcp__pilote__tache_suspendre' }, async ($, e) => apply($, (p, now) => suspend(p, str(e.id), str(e.raison), now, session)))
  on('tool.call', { tool: 'mcp__pilote__tache_abandonner' }, async ($, e) => apply($, (p, now) => drop(p, str(e.id), str(e.raison), now, session)))
  on('tool.call', { tool: 'mcp__pilote__question_poser' }, async ($, e) =>
    apply($, (p, now) => ask(p, { question: str(e.question), enjeu: str(e.enjeu), options: list(e.options), bloque: list(e.bloque) }, now)))
  on('tool.call', { tool: 'mcp__pilote__question_trancher' }, async ($, e) =>
    apply($, (p, now) => decide(p, str(e.id), str(e.decision), str(e.mots_du_proprietaire), now)))
  on('tool.call', { tool: 'mcp__pilote__pilotage_etat' }, async $ => {
    const s = await refresh($, true)
    if (!s.data) return { deny: s.isFound ? `${FILE} illisible : ${s.errors.join(' ; ')}` : `Pas de ${FILE} ici.` }
    const errors = s.errors.length ? `\n\nFICHIER : ${s.errors.join(' ; ')}` : ''
    return { result: summary(s.data, await $.clock.now()) + errors }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Progress } = $.ui.resolve(e)
    const s = await read($, snap)
    const pending = await read($, armed)
    const now = await $.clock.now()
    if (!s.isFound) return <Text dimColor>Pas de {FILE} dans ce dossier.</Text>
    if (!s.data) return <Text color="error">{FILE} illisible : {s.errors.join(' ; ')}</Text>
    const p = s.data

    const row = (r: Row) => {
      const a = r.action
      const asking = !!a && pending?.id === a.id
      return (
        <Box key={r.key} flexDirection="row" gap={1}>
          <Box flexGrow={1} flexShrink={1}>
            <Text wrap="truncate-end" color={r.tone}>{asking ? (a?.confirm ?? r.text) : r.text}</Text>
          </Box>
          {a && asking && <Button key={`yes:${a.id}`} label="Oui" variant="primary" onPress={() => void update($, armed, () => null).then(() => act($, a.id))} />}
          {a && asking && <Button key={`no:${a.id}`} label="Non" onPress={() => void update($, armed, () => null)} />}
          {a && !asking && <Button key={`act:${a.id}`} label={a.label} onPress={() => void press($, a)} />}
        </Box>
      )
    }
    const section = (title: string, rows: Row[], empty: string) => (
      <Box key={title} flexDirection="column" marginTop={1}>
        <Text bold>{title}</Text>
        {rows.length ? rows.map(row) : <Text dimColor>{empty}</Text>}
      </Box>
    )
    const j = currentJalon(p)
    const jc = jalonCounts(p).find(c => c.id === j?.id)
    const read_at = new Date(s.readAt).toISOString().slice(11, 16)

    return (
      <Box flexDirection="column">
        {j && jc ? <Progress label={`${j.id} ${j.titre}${j.go ? '' : ' · sans go'}`} value={jc.done} max={Math.max(1, jc.total)} valueText={`${jc.done}/${jc.total}`} /> : <Text color="success">Tous les jalons sont faits.</Text>}
        {section('À TOI', toiRows(p, now), 'rien ne t’attend')}
        {section('EN COURS', coursRows(p, now), 'aucune tâche en cours')}
        {section('PROCHAINES', nextRows(p), j?.go ? 'aucune tâche prête' : `rien de prêt avant le go de ${j?.id ?? 'jalon'}`)}
        <Box flexDirection="column" marginTop={1}>
          <Text bold>PAR SCOPE</Text>
          {scopeCounts(p).map(c => (
            <Progress key={c.id} label={c.label} value={c.done} max={Math.max(1, c.total)} valueText={`${c.done}/${c.total}${c.blocked ? ` · ${c.blocked} bloquées` : ''}`} />
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text bold>JALONS</Text>
          {jalonCounts(p).map(c => (
            <Text key={c.id} wrap="truncate-end" dimColor={c.total > 0 && c.done === c.total}>
              {c.label} · {c.done}/{c.total}{c.blocked ? ` · ${c.blocked} bloquées` : ''}
            </Text>
          ))}
        </Box>
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Box flexGrow={1}>
            <Text dimColor color={s.errors.length ? 'warning' : undefined} wrap="truncate-end">
              {s.errors.length ? `${s.errors.length} incohérence(s) : ${s.errors[0]}` : `lu à ${read_at} UTC`}
            </Text>
          </Box>
          <Button key="act:refresh" label="Rafraîchir" plain onPress={() => void act($, 'refresh')} />
        </Box>
      </Box>
    )
  })
}

async function registerTools($: EngineInterface): Promise<void> {
  const id = { type: 'string', description: 'Id de la tâche, par exemple CON-01' }
  const tools = [
    {
      name: 'tache_demarrer',
      description: `Passe une tâche de ${FILE} en cours et rend sa fiche (résultat, critères, dépendances). Refuse si elle n’est pas prête (dépendance non faite, question ouverte, jalon sans go), si cette session tient déjà le maximum de tâches, ou si une tâche en cours écrit les mêmes chemins. Une tâche tenue par une autre session ne se reprend qu’avec reprendre: true, quand cette session est arrêtée. À appeler avant de coder.`,
      inputSchema: { type: 'object', properties: { id, reprendre: { type: 'boolean', description: 'Reprendre une tâche en cours tenue par une session arrêtée' } }, required: ['id'] },
    },
    {
      name: 'tache_note',
      description: 'Note l’avancement d’une tâche en cours : fait, reste, suivant (la prochaine action concrète). Après chaque étape, pour qu’une autre session reprenne.',
      inputSchema: { type: 'object', properties: { id, fait: { type: 'string' }, reste: { type: 'string' }, suivant: { type: 'string' } }, required: ['id', 'fait', 'reste', 'suivant'] },
    },
    {
      name: 'tache_terminer',
      description: 'Termine une tâche en cours. Exige la preuve (commandes lancées en local et leur résultat : il n’y a pas de CI) et le numéro (à partir de 1) de chaque critère d’acceptation couvert : refuse s’il en manque un. Lance ensuite lui-même la gate du projet (projet.verification) sur les chemins de la tâche et refuse si elle échoue ; sa sortie s’ajoute à la preuve. Pour une tâche qui touche aux données, lance lui-même le sous-agent de relecture (projet.relecteur) sur le diff et refuse sans verdict OK. Peut prendre plusieurs minutes. Dit quelles tâches deviennent prêtes.',
      inputSchema: {
        type: 'object',
        properties: { id, preuve: { type: 'string' }, criteres_couverts: { type: 'array', items: { type: 'number' }, description: 'Numéros des critères couverts, à partir de 1' },
          relecture_verdict: { type: 'string', enum: ['OK', 'A_CORRIGER', 'BLOQUANT'], description: 'Verdict déclaré de la relecture, lu seulement quand projet.relecteur est absent (sinon le mod lance le relecteur lui-même)' },
          relecture: { type: 'string', description: 'Ce que la relecture a vérifié, en une ou deux lignes (seulement sans projet.relecteur)' },
        },
        required: ['id', 'preuve', 'criteres_couverts'],
      },
    },
    {
      name: 'tache_suspendre',
      description: 'Remet une tâche en cours dans le backlog, avec la raison (bloquée par une découverte, priorité changée).',
      inputSchema: { type: 'object', properties: { id, raison: { type: 'string' } }, required: ['id', 'raison'] },
    },
    {
      name: 'tache_abandonner',
      description: 'Abandonne une tâche qu’une décision du propriétaire rend inutile (par exemple une question tranchée par « non »). Elle ne bloque plus ce qui la suit. Toujours avec la raison.',
      inputSchema: { type: 'object', properties: { id, raison: { type: 'string', description: 'La décision qui la rend inutile' } }, required: ['id', 'raison'] },
    },
    {
      name: 'question_poser',
      description: 'Pose une question au propriétaire (une décision qui lui revient) et bloque les tâches qui en dépendent jusqu’à sa réponse. À utiliser dès qu’une découverte change le plan, plutôt que d’élargir une tâche en silence.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' }, enjeu: { type: 'string', description: 'Ce qui dépend de la réponse' }, options: { type: 'array', items: { type: 'string' } }, bloque: { type: 'array', items: { type: 'string' }, description: 'Ids des tâches bloquées' } },
        required: ['question', 'enjeu', 'options', 'bloque'],
      },
    },
    {
      name: 'question_trancher',
      description: 'Enregistre la décision du propriétaire sur une question ouverte, avec ses mots. Jamais sans une réponse explicite de sa part. Dit quelles tâches deviennent prêtes.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Id de la question, par exemple Q-01' }, decision: { type: 'string' }, mots_du_proprietaire: { type: 'string', description: 'Sa réponse, citée' } }, required: ['id', 'decision', 'mots_du_proprietaire'] },
    },
    {
      name: 'pilotage_etat',
      description: `Résumé de ${FILE} : ce qui attend le propriétaire, les tâches en cours, les prochaines prêtes, l’avancement des jalons.`,
      inputSchema: { type: 'object', properties: {} },
    },
  ]
  for (const t of tools) await $.tool.register({ ...t, isDeferred: false })
}
