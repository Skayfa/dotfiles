import { expect, test } from 'claude-code/testing'
import { HOME, ROOT, START, TYPED, page, ran, world } from './world.ts'

const TICKETS = '/v1/data_sources/1280ffb8-c088-8185-8688-000b4b3beb07/query'
const MR = { iid: 2962, title: '[ET-4449][ET-4481] Compétences', draft: true, source_branch: 'ET-4449-ET-4481-competences', author: { username: 'younes.b' }, web_url: 'u', updated_at: '2026-10-30T09:00:00Z' }
const NOTES = 'NEW_NOTES:1:romain\nstate=opened pipeline=success pending=0 failed=- conflicts=false draft=true open_threads=1 draft_notes=0\nab12cd34 romain app/x.tsx:3 | encodage ?'

// Notion answers by ticket number; glab and mrwatch by URL.
function dolmen(pages: Record<number, ReturnType<typeof page>>, digest = NOTES) {
  return (argv: string[], body: unknown) => {
    const url = argv.find(a => a.startsWith('URL='))?.slice(4)
    if (url === TICKETS) {
      const n = (body as { filter?: { unique_id?: { equals: number } } })?.filter?.unique_id?.equals
      return { stdout: JSON.stringify({ object: 'list', results: n && pages[n] ? [pages[n]] : [] }) }
    }
    if (url?.startsWith('/v1/pages/')) return { stdout: '{"object":"page"}' }
    if (argv[0] === 'glab' && argv[2]?.includes('scope=created_by_me')) return { stdout: JSON.stringify([MR]) }
    if (argv.includes('-mr')) return { stdout: digest }
    if (argv[0] === 'git' && argv.includes('rev-parse')) return { stdout: `${ROOT}/.git` }
    return {}
  }
}

test('/ticket opens one lot for two tickets of one scope: claims, branch, ccw worktree', async ($, on) => {
  const { calls } = world(on, { answer: dolmen({ 4449: page(4449, 'Archiver une compétence', { priority: 'High' }), 4481: page(4481, 'Export PDF fiche de poste', { priority: 'High' }) }) })
  await $.session.start(START)
  const out = await $.command.run({ command: 'ticket', args: 'ET-4449 ET-4481', ...TYPED })
  expect(out.text).toContain('Lot ET-4449-ET-4481-archiver-une-competence-export-pdf')
  expect(out.text).toContain('ccw new ET-4449-ET-4481')
  expect(ran(calls, 'tmux', 'new-window')).toBe(false)
  expect(ran(calls, 'task', 'dew-claim', 'ID=ET-4449')).toBe(true)
  expect(ran(calls, 'task', 'dew-claim', 'ID=ET-4481')).toBe(true)
  expect(calls.some(c => c.argv.includes('worktree') && c.argv.includes('--no-track') && c.argv.some(a => a.startsWith(`${HOME}/ET-4449-ET-4481`)))).toBe(true)
  expect(calls.some(c => c.argv.includes('push'))).toBe(false)
})

test('/ticket stops before claiming when a Critical would join a lot, unless forced', async ($, on) => {
  const { calls } = world(on, { answer: dolmen({ 4449: page(4449, 'a', { priority: 'High' }), 4236: page(4236, 'b', { priority: 'Critical' }) }) })
  await $.session.start(START)
  expect((await $.command.run({ command: 'ticket', args: 'ET-4449 ET-4236', ...TYPED })).text).toContain('Critical sort seul')
  expect(ran(calls, 'task', 'dew-claim')).toBe(false)
  expect((await $.command.run({ command: 'ticket', args: 'ET-4449 ET-4236 force', ...TYPED })).text).toContain('Lot ET-4449-ET-4236')
})

const LOT = `${HOME}/ET-4449-ET-4481-competences`

// git status answers the lot's branch in its worktree, main elsewhere.
function withBranch(answer: ReturnType<typeof dolmen>) {
  return (argv: string[], body: unknown) =>
    argv.includes('status') ? { stdout: argv.includes(LOT) ? '## ET-4449-ET-4481-competences...origin/ET-4449-ET-4481-competences' : '## main...origin/main' } : answer(argv, body)
}

test('the session of a lot wakes once on a new thread of its own MR, and its tickets move to Merge request', async ($, on) => {
  const { calls, prompts, clock, notes } = world(on, { cwd: LOT, answer: withBranch(dolmen({ 4449: page(4449, 'a', { status: 'In Progress' }), 4481: page(4481, 'b', { status: 'Merge request' }) })) })
  await $.session.start({ ...START, cwd: LOT })
  await clock.advance(2 * 60_000 + 10)
  await clock.settle()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('!2962')
  expect(prompts[0]).toContain('romain app/x.tsx:3 | encodage ?')
  expect(prompts[0]).toContain('babysit-mr-empowill')
  expect(notes).toHaveLength(0)
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(prompts).toHaveLength(1)
  expect(calls.filter(c => c.argv.includes('URL=/v1/pages/page-4449') && c.argv.includes('METHOD=PATCH'))).toHaveLength(1)
  expect(calls.some(c => c.argv.includes('URL=/v1/pages/page-4481'))).toBe(false)
})

test('the Lead session never wakes: it notifies where to go', async ($, on) => {
  const { prompts, clock, notes } = world(on, { answer: withBranch(dolmen({})) })
  await $.session.start(START)
  await clock.advance(2 * 60_000 + 10)
  await clock.settle()
  expect(prompts).toHaveLength(0)
  expect(notes[0]).toContain('!2962 NEW_NOTES:1:romain → ccw attach ET-4449-ET-4481-competences')
})

test('leaving Draft is allowed only after a /pret typed by Younes, for that MR', async ($, on) => {
  world(on, { answer: dolmen({}) })
  on('tool.call', (_, e) => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  await $.session.start(START)
  expect((await $.tool.call({ tool: 'Bash', command: 'glab mr update 2962 --ready' })).deny).toContain('pret')
  expect((await $.command.run({ command: 'pret', args: '2962', ...TYPED, origin: { kind: 'sdk' } })).text).toContain('tapé par toi')
  expect((await $.command.run({ command: 'pret', args: '2962', ...TYPED })).text).toContain('verify')
  expect((await $.tool.call({ tool: 'Bash', command: 'glab mr update 2962 --ready' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Bash', command: 'glab mr update 2963 --ready' })).deny).toContain('pret')
})

test('/pret refuses a red MR', async ($, on) => {
  world(on, { answer: dolmen({}, 'state=opened pipeline=failed pending=0 failed=test-go conflicts=false draft=true open_threads=0 draft_notes=0') })
  await $.session.start(START)
  expect((await $.command.run({ command: 'pret', args: '2962', ...TYPED })).text).toContain("n'est pas prête")
})

test('test output is trimmed in Dolmen, and outside Dolmen the mod stays quiet', async ($, on) => {
  const seen: string[] = []
  const files: Record<string, string> = {}
  world(on, { files, answer: argv => (argv.includes('rev-parse') ? { stdout: '/w/other/.git' } : {}) })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') seen.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  await $.session.start({ ...START, cwd: '/w/other' })
  await $.tool.call({ tool: 'Bash', command: 'git add -A' })
  expect(seen).toEqual(['git add -A'])
})

test('task test-pkg runs wrapped in a Dolmen session', async ($, on) => {
  const seen: string[] = []
  world(on, { answer: dolmen({}) })
  on('tool.call', (_, e) => {
    if (e.tool === 'Bash') seen.push(e.command)
    return { result: { stdout: 'ok', stderr: '', interrupted: false } }
  })
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'task test-pkg PKG=./go/api/syn/...' })
  expect(seen[0]).toContain('dolmen-ops: full log')
})

test('/etat answers at once, and from what the background read, ranks the bugs by SLO and shows MRs, DEW and quota', async ($, on) => {
  const base = dolmen({})
  const { clock } = world(on, {
    answer: (argv, body) => {
      const url = argv.find(a => a.startsWith('URL='))?.slice(4) ?? ''
      if (argv[0] === 'git' && argv.includes('user.email')) return { stdout: 'younes.b@empowill.com' }
      if (url.startsWith('/v1/users')) return { stdout: JSON.stringify({ object: 'list', results: [{ id: 'me', type: 'person', person: { email: 'younes.b@empowill.com' } }] }) }
      if (url.includes('27f0ffb8')) {
        return { stdout: JSON.stringify({ object: 'list', results: [{ id: 'scope-comp', url: 's', created_time: '', properties: { Name: { type: 'title', title: [{ plain_text: 'Compétence & postes' }] }, Maintainer: { type: 'people', people: [{ id: 'me' }] } } }] }) }
      }
      if (url === TICKETS && (body as { filter?: { and?: unknown } })?.filter?.and) {
        return { stdout: JSON.stringify({ object: 'list', results: [page(4236, 'Autorisation de conduite', { priority: 'Critical', assignees: ['me'], created: '2026-09-29T09:00:00Z' }), page(4481, 'Export PDF', { priority: 'High', created: '2026-10-28T09:00:00Z' })] }) }
      }
      if (argv[0] === 'task' && argv[1] === 'dew') return { stdout: 'ET-3945  High  -  Frontend  Simple  Champs personnalisés  https://n/b' }
      return base(argv, body)
    },
  })
  await $.session.start(START)
  expect((await $.command.run({ command: 'etat', args: '', ...TYPED })).text).toContain('Premier chargement')
  await clock.advance(10)
  await clock.settle()
  const out = (await $.command.run({ command: 'etat', args: '', ...TYPED })).text ?? ''
  expect(out).toContain('ET-4236 Autorisation de conduite : Critical · 23 j / 3 j · À TOI')
  expect(out).toContain('ET-4481 Export PDF : High · 2 j / 15 j · personne')
  expect(out.indexOf('ET-4236 Autorisation')).toBeLessThan(out.indexOf('ET-4481 Export'))
  expect(out).toContain('!2962 ET-4449 + ET-4481 : ● vert · 1 fil · Draft')
  expect(out).toContain('ET-3945 Champs personnalisés : High · Simple')
  expect(out).toContain('Quota semaine : 42 %')
})

test('/plan hands its prompt to the model once the command has answered', async ($, on) => {
  const { prompts, clock } = world(on, { answer: dolmen({}) })
  await $.session.start(START)
  expect((await $.command.run({ command: 'plan', args: '', ...TYPED })).text).toContain("part à l'agent")
  await clock.advance(10)
  expect(prompts[0]).toContain('grill')
})

test('inside tmux, /ticket opens the lot session in a window beside this one', async ($, on) => {
  const { calls } = world(on, { env: { TMUX: '/tmp/tmux-501/default,1,0' }, answer: dolmen({ 4236: page(4236, 'Autorisation de conduite', { priority: 'Critical' }) }) })
  await $.session.start(START)
  const out = await $.command.run({ command: 'ticket', args: 'ET-4236', ...TYPED })
  expect(out.text).toContain('fenêtre tmux « ET-4236 »')
  expect(calls.some(c => c.argv.join(' ') === `tmux new-window -d -n ET-4236 -c ${HOME}/ET-4236-autorisation-de-conduite claude`)).toBe(true)
})
