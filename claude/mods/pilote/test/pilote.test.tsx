import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Pilotage } from '../types'
import { FILE, cutErrors, drop, finish, go, parse, serialize, start, statut, statusMoves } from '../hooks/rules.ts'

const NOW = Date.parse('2026-11-21T10:00:00Z')

const base = (): Pilotage => ({
  version: 1,
  projet: { nom: 'demo', promesse: 'p', maj: '2026-11-21' },
  jalons: [
    { id: 'M1', titre: 'Contrat', resultat: 'r', statut: 'a_venir' },
    { id: 'M2', titre: 'Domaine', resultat: 'r', statut: 'a_venir' },
  ],
  scopes: [{ id: 'contrat', titre: 'Contrat', verdict: 'v', garder: [], couper: [], repousser: [] }],
  taches: [
    { id: 'CON-01', scope: 'contrat', jalon: 'M1', titre: 'Schéma boîte', resultat: 'r', criteres: ['a', 'b'], priorite: 'P0', taille: 'S', risque_donnees: true, invariant: 'annuler restaure l’état', depend_de: [], bloque_par: [], statut: 'backlog', depuis: '2026-11-21', chemins: ['contracts/schemas/v1/boite.schema.json'] },
    { id: 'CON-02', scope: 'contrat', jalon: 'M1', titre: 'Schéma entrée', resultat: 'r', criteres: ['a'], priorite: 'P0', taille: 'S', risque_donnees: false, depend_de: ['CON-01'], bloque_par: [], statut: 'backlog', depuis: '2026-11-21' },
    { id: 'CON-03', scope: 'contrat', jalon: 'M1', titre: 'Rappel', resultat: 'r', criteres: ['a'], priorite: 'P1', taille: 'S', risque_donnees: false, depend_de: [], bloque_par: ['Q-01'], statut: 'backlog', depuis: '2026-11-21' },
  ],
  questions: [{ id: 'Q-01', question: 'CloudKit ou Supabase ?', enjeu: 'synchro', options: ['CloudKit', 'Supabase'], bloque: ['CON-03'], statut: 'ouverte', decision: '', date: '' }],
  journal: [],
})

const ok = <T,>(m: T | { refus: string }): T => {
  if (typeof m === 'object' && m !== null && 'refus' in m) throw new Error(m.refus)
  return m as T
}

test('a task waits for the go, its dependencies and its questions', () => {
  const p = base()
  expect(statut(p, p.taches[0])).toBe('backlog')
  expect(statut(p, p.taches[2])).toBe('bloque')
  expect('refus' in start(p, 'CON-01', NOW)).toBe(true)
  const g = ok(go(p, 'M1', NOW)).file
  expect(statut(g, g.taches[0])).toBe('pret')
  expect(statut(g, g.taches[1])).toBe('backlog')
  expect(g.taches[0].statut).toBe('pret')
  expect(g.jalons[0].statut).toBe('en_cours')
})

test('finishing needs the proof and every criterion, then unlocks what follows', () => {
  const g = ok(go(base(), 'M1', NOW)).file
  const s = ok(start(g, 'CON-01', NOW))
  expect(s.said).toContain('invariant')
  expect((finish(s.file, 'CON-01', '', [1, 2], NOW) as { refus: string }).refus).toContain('preuve')
  expect((finish(s.file, 'CON-01', 'make test-domain vert', [1], NOW) as { refus: string }).refus).toContain('2. b')
  expect((finish(s.file, 'CON-01', 'make test-domain vert', [1, 2], NOW) as { refus: string }).refus).toContain('relecture locale')
  expect((finish(s.file, 'CON-01', 'make test-domain vert', [1, 2], NOW, { verdict: 'BLOQUANT', texte: 'perte' }) as { refus: string }).refus).toContain('BLOQUANT')
  const f = ok(finish(s.file, 'CON-01', 'make test-domain vert', [1, 2], NOW, { verdict: 'OK', texte: 'inverse testé' }))
  expect(f.file.taches[0].relecture).toBe('OK · inverse testé')
  expect(f.said).toContain('CON-02')
  expect(f.file.taches[0].statut).toBe('fait')
})

test('the work in progress is capped', () => {
  let p = ok(go(base(), 'M1', NOW)).file
  p = { ...p, projet: { ...p.projet, wip_max: 1 }, questions: [] , taches: p.taches.map(t => ({ ...t, bloque_par: [] })) }
  p = ok(start(p, 'CON-01', NOW)).file
  expect((start(p, 'CON-03', NOW) as { refus: string }).refus).toContain('maximum')
})

test('the file check names broken references', () => {
  const p = base()
  p.taches[1].depend_de = ['CON-99']
  expect(parse(serialize(p)).errors.join()).toContain('CON-99')
  expect(parse('{').data).toBeNull()
})

test('a bad cut is named: cycle, shared path without order, size L, no criteria, no invariant', () => {
  const p = base()
  p.projet.zones_liees = [['contracts/', 'apple/Packages/Generated/']]
  p.taches[2].chemins = ['apple/Packages/Generated/Boite.swift']
  p.taches[1].criteres = []
  p.taches[1].taille = 'L'
  const errors = cutErrors(p).join('\n')
  expect(errors).toContain('CON-01 et CON-03 écrivent contracts/')
  expect(errors).toContain('CON-02 : aucun critère')
  expect(errors).toContain('CON-02 : taille L')
  p.taches[0].invariant = ''
  p.taches[0].depend_de = ['CON-02']
  const more = cutErrors(p).join('\n')
  expect(more).toContain('CON-01 : touche aux données sans invariant')
  expect(more).toContain('CON-01 : cycle')
  // ordered tasks may share a path
  const q = base()
  q.taches[1].chemins = ['contracts/schemas/v1/boite.schema.json']
  expect(cutErrors(q)).toEqual([])
})

test('two sessions: paths in progress are locked, a held task is not touched, a stopped one is taken over', () => {
  let p = ok(go(base(), 'M1', NOW)).file
  p = { ...p, questions: [], taches: p.taches.map(t => ({ ...t, bloque_par: [] })) }
  p.taches[2].chemins = ['contracts/schemas/v1/']
  p = ok(start(p, 'CON-01', NOW, 'A')).file
  expect((start(p, 'CON-03', NOW, 'B') as { refus: string }).refus).toContain('CON-01 (en cours)')
  expect((finish(p, 'CON-01', 'ok', [1, 2], NOW, { verdict: 'OK', texte: '' }, 'B') as { refus: string }).refus).toContain('autre session')
  expect((start(p, 'CON-01', NOW, 'B') as { refus: string }).refus).toContain('reprendre')
  p = ok(start(p, 'CON-01', NOW, 'B', true)).file
  expect(p.taches[0].tenue_par).toBe('B')
  expect(ok(finish(p, 'CON-01', 'ok', [1, 2], NOW, { verdict: 'OK', texte: '' }, 'B')).file.taches[0].tenue_par).toBeUndefined()
})

test('a dropped task no longer holds what follows it', () => {
  let p = ok(go(base(), 'M1', NOW)).file
  expect((drop(p, 'CON-01', '', NOW) as { refus: string }).refus).toContain('pourquoi')
  const d = ok(drop(p, 'CON-01', 'Q-02 : non', NOW))
  expect(d.said).toContain('CON-02')
  p = d.file
  expect(statusMoves(base(), p)).toContain('CON-01 backlog → abandonne')
})

test('only status moves are seen as moves', () => {
  const p = base()
  const reworded = { ...p, taches: p.taches.map(t => ({ ...t, titre: `${t.titre} v2`, statut: 'pret' as const })) }
  expect(statusMoves(p, reworded)).toEqual([])
  const cheated = { ...p, taches: p.taches.map(t => (t.id === 'CON-01' ? { ...t, statut: 'fait' as const } : t)) }
  expect(statusMoves(p, cheated)).toEqual(['CON-01 backlog → fait'])
})

// --- the mod in a session ----------------------------------------------------------------------

const PANE = {
  plugin: 'pilote',
  component: 'Pane',
  requestId: 'pilote',
  props: { title: 'Pilotage', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

type Opts = { onRead?: (n: number) => void }

function world(on: On, files: Record<string, string>, prompts: string[] = [], opts: Opts = {}) {
  let reads = 0
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__pilote__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  const rel = (path: string) => path.replace(/^\/p\//, '')
  on('fs.stat', (_, e) => {
    const f = files[rel(e.path)]
    return f === undefined ? ({ deny: 'ENOENT' } as never) : { value: { kind: 'file' as const, size: f.length, mtimeMs: f.length, isLink: false } }
  })
  on('fs.read', (_, e) => (opts.onRead?.(++reads), files[rel(e.path)] === undefined ? { deny: 'ENOENT' } : { value: files[rel(e.path)] }) as never)
  on('fs.write', (_, e) => ((files[rel(e.path)] = e.text), { value: undefined }))
  on('prompt.submit', (_, e) => (prompts.push(e.text), { text: e.text }) as never)
  on('tool.call', () => ({ result: 'edited' }) as never)
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '/p/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  return { files, prompts }
}

test('the tools keep the gates and write the file', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { files } = world(on, { [FILE]: serialize(base()) })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  const early = await $.tool.call({ tool: 'mcp__pilote__tache_demarrer', id: 'CON-01' })
  expect(early.deny).toContain('go M1')

  const typed = await $.command.run({ command: 'go', args: 'm1', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(typed.text).toContain('Go M1')
  const started = await $.tool.call({ tool: 'mcp__pilote__tache_demarrer', id: 'CON-01' })
  expect(String(started.result)).toContain('CON-01 en cours')
  expect(JSON.parse(files[FILE]).taches[0].statut).toBe('en_cours')

  const done = await $.tool.call({ tool: 'mcp__pilote__tache_terminer', id: 'CON-01', preuve: 'tests verts', criteres_couverts: [1, 2], relecture_verdict: 'OK', relecture: 'rien' })
  expect(String(done.result)).toContain('Prêtes maintenant : CON-02')
})

test('a go sent by a plugin is refused', async ($, on) => {
  mock.clock(on, { now: NOW })
  const { files } = world(on, { [FILE]: serialize(base()) })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const sent = await $.command.run({ command: 'go', args: 'M1', origin: { kind: 'plugin', name: 'x' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(sent.text).toContain('à la main')
  expect(JSON.parse(files[FILE]).jalons[0].go).toBeUndefined()
})

test('an edit that moves a status is refused, a reword passes', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { [FILE]: serialize(base()) })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const text = serialize(base())
  const cheat = await $.tool.call({ tool: 'Write', file_path: `/p/${FILE}`, content: text.replace('"statut": "backlog"', '"statut": "fait"') })
  expect(cheat.deny).toContain('outils pilote')
  const broken = await $.tool.call({ tool: 'Edit', file_path: `/p/${FILE}`, old_string: '"version": 1,', new_string: '"version": 1', replace_all: false })
  expect(broken.deny).toContain('illisible')
  const reword = await $.tool.call({ tool: 'Edit', file_path: `/p/${FILE}`, old_string: 'Schéma boîte', new_string: 'Schéma de la boîte', replace_all: false })
  expect(reword.deny).toBeUndefined()
})

test('the pane shows what waits for the owner, and its buttons act', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const { files, prompts } = world(on, { [FILE]: serialize(base()) })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Q-01 CloudKit/ }))?.text).toContain('bloque 1')
    expect(await ui.find({ type: 'Text', text: /M1 Contrat attend ton go/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'act:answer:Q-01' })
  expect(prompts.at(-1)).toContain('question_trancher')

  await ui.press({ key: 'act:go:M1' })
  expect(JSON.parse(files[FILE]).jalons[0].go).toBeUndefined()
  await ui.press({ key: 'yes:go:M1' })
  expect(JSON.parse(files[FILE]).jalons[0].go).toBe('2026-11-21')

  await ui.press({ key: 'act:start:CON-01' })
  expect(prompts.at(-1)).toContain('tache_demarrer')
  await ui.unmount()
})

test('no file, no pane and no method section', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, {})
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toContain('Pas de')
  await ui.unmount()
})

test('a move made while another session wrote keeps both', async ($, on) => {
  mock.clock(on, { now: NOW })
  const files: Record<string, string> = { [FILE]: serialize(base()) }
  let after = -1
  // The other session gives the go after this session's first read, before its write.
  world(on, files, [], { onRead: () => { if (after >= 0 && ++after === 2) files[FILE] = serialize(ok(go(base(), 'M1', NOW)).file) } })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  after = 0
  const asked = await $.tool.call({ tool: 'mcp__pilote__question_poser', question: 'Où ?', enjeu: 'x', options: ['a'], bloque: [] })
  expect(String(asked.result)).toContain('Q-02')
  const now = JSON.parse(files[FILE])
  expect(now.jalons[0].go).toBe('2026-11-21')
  expect(now.questions.map((q: { id: string }) => q.id)).toEqual(['Q-01', 'Q-02'])
})

test('a worktree copy of the file is refused, the main one is the truth', async ($, on) => {
  mock.clock(on, { now: NOW })
  world(on, { [FILE]: serialize(base()) })
  await $.session.start({ cwd: '/p-wt/feat-1', surface: 'terminal', isInteractive: true })
  const copy = await $.tool.call({ tool: 'Edit', file_path: `/p-wt/feat-1/${FILE}`, old_string: 'Schéma boîte', new_string: 'x', replace_all: false })
  expect(copy.deny).toContain('copie')
  const state = await $.tool.call({ tool: 'mcp__pilote__pilotage_etat' })
  expect(String(state.result)).toContain('demo')
})
