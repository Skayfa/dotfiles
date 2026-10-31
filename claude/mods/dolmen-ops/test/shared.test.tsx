// What came over from seammo-ops: the state a reload keeps, the reads shared by the sessions of the
// Mac, the pane's buttons in the session that holds the work, and no ccw.
import type { On } from 'claude-code'
import { expect, test, type TestBody } from 'claude-code/testing'
import { HOME, NOW, ROOT, START, TYPED, page, ran, world, type World } from './world.ts'

type $T = Parameters<TestBody>[0]
const LOT = 'ET-4449-ET-4481-competences'
const MR = { iid: 2962, title: '[ET-4449][ET-4481] Compétences', draft: true, source_branch: LOT, author: { username: 'younes.b' }, web_url: 'u', updated_at: '2026-10-29T08:00:00Z' }
const THREAD = 'NEW_NOTES:1:romain\nstate=opened pipeline=success pending=0 failed=- conflicts=false draft=true open_threads=1 draft_notes=0\nab12cd34 romain app/x.tsx:3 | encodage ?'
const GREEN = 'state=opened pipeline=success pending=0 failed=- conflicts=false draft=true open_threads=0 draft_notes=0'
const TICKETS = '/v1/data_sources/1280ffb8-c088-8185-8688-000b4b3beb07/query'

function gitlab(digest: string, pages: Record<number, ReturnType<typeof page>> = {}) {
  return (argv: string[], body: unknown) => {
    const url = argv.find(a => a.startsWith('URL='))?.slice(4)
    if (url === TICKETS) {
      const n = (body as { filter?: { unique_id?: { equals: number } } })?.filter?.unique_id?.equals
      return { stdout: JSON.stringify({ object: 'list', results: n && pages[n] ? [pages[n]] : [] }) }
    }
    if (argv[0] === 'glab' && argv[2]?.includes('scope=created_by_me')) return { stdout: JSON.stringify([MR]) }
    if (argv.includes('-mr')) return { stdout: digest }
    if (argv[0] === 'git' && argv.includes('rev-parse')) return { stdout: `${ROOT}/.git` }
    if (argv.includes('status')) return { stdout: '## main...origin/main' }
    return {}
  }
}

const PANE = { plugin: 'dolmen-ops', component: 'Pane', requestId: 'dolmen-ops', surface: 'terminal', props: { title: 'Dolmen', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } } as const

async function pane($: $T, on: On, w: World) {
  const ww = world(on, w)
  await $.session.start(START)
  await $.command.run({ command: 'panneau', args: '', ...TYPED })
  await ww.clock.advance(10)
  await ww.clock.settle()
  return { ...ww, ui: await $.ui.mount(PANE) }
}

test('the MR events told are kept in $.state, which a reload keeps: no second wake for the same threads', async ($, on) => {
  const { clock, sent } = world(on, { agents: [{ id: 'ag-1', status: 'idle' }], store: { lotAgents: { [LOT]: 'ag-1' } }, dirs: { [HOME]: [LOT] }, answer: gitlab(THREAD) })
  await $.session.start(START)
  await clock.advance(2 * 60_000 + 10)
  await clock.settle()
  expect(sent.filter(m => m.text.includes('!2962'))).toHaveLength(1)
  await $.session.start(START) // what /reload-plugins runs again
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(sent.filter(m => m.text.includes('!2962'))).toHaveLength(1)
})

test('what another session of the Mac read a moment ago is used, with no glab call', async ($, on) => {
  const dir = '/w/.cache/shared-1'
  const mrs = JSON.stringify({ at: NOW - 30_000, loadedAt: NOW - 30_000, data: [{ mr: { iid: 2962, title: 't', draft: true, branch: LOT, author: 'younes.b', url: 'u', updatedAt: '2026-10-30T09:00:00Z', tickets: ['ET-4449'] }, d: { events: [], pipeline: 'success', failed: [], conflicts: false, draft: true, openThreads: 0, threads: [] } }] })
  const files = { [`${ROOT}/cmd/dolmen/main.go`]: 'package main', [`${dir}/mrs.v1.json`]: mrs }
  const { calls, clock } = world(on, { env: { DOLMEN_OPS_CACHE: dir }, files, answer: gitlab(THREAD) })
  await $.session.start(START)
  await clock.advance(10)
  await clock.settle()
  calls.length = 0
  await $.command.run({ command: 'pret', args: '2962', ...TYPED })
  expect(calls.some(c => c.argv[0] === 'glab' && c.argv[2]?.includes('scope=created_by_me'))).toBe(false)
})

test('the pane: Traiter sends the MR’s threads to the lot’s agent, Prête asks first then allows leaving Draft', async ($, on) => {
  const { ui, sent } = await pane($, on, { agents: [{ id: 'ag-1', status: 'idle' }], store: { lotAgents: { [LOT]: 'ag-1' } }, dirs: { [HOME]: [LOT] }, answer: gitlab(THREAD) })
  expect(await ui.find({ type: 'Text', text: /1 fil · Draft · bougée il y a 26 h/ })).toBeDefined()
  await ui.press({ key: 'act:treat:2962' })
  expect(sent.some(m => m.to === 'ag-1' && m.text.includes('babysit-mr-empowill'))).toBe(true)
  await ui.unmount()
})

test('a green Draft MR offers Prête: confirmed, it allows `glab mr update --ready` for that MR', async ($, on) => {
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }))
  const { ui } = await pane($, on, { agents: [{ id: 'ag-1', status: 'idle' }], store: { lotAgents: { [LOT]: 'ag-1' } }, dirs: { [HOME]: [LOT] }, answer: gitlab(GREEN) })
  expect((await $.tool.call({ tool: 'Bash', command: 'glab mr update 2962 --ready' })).deny).toContain('pret')
  await ui.press({ key: 'act:ready:2962' })
  expect(await ui.find({ type: 'Text', text: /sortie de Draft \?/ })).toBeDefined()
  await ui.press({ key: 'yes:ready:2962' })
  expect((await $.tool.call({ tool: 'Bash', command: 'glab mr update 2962 --ready' })).deny).toBeUndefined()
  await ui.unmount()
})

test('a lot another session works has no button here, and its MR events are left to that session', async ($, on) => {
  const dir = '/w/.cache/shared-2'
  const book = JSON.stringify({ at: NOW - 30_000, loadedAt: NOW - 30_000, data: { 'sess-lot': { at: NOW - 30_000, lead: false, branches: [LOT] } } })
  const files = { [`${ROOT}/cmd/dolmen/main.go`]: 'package main', [`${dir}/sessions.v1.json`]: book }
  const { ui, notes, clock } = await pane($, on, { env: { DOLMEN_OPS_CACHE: dir }, files, dirs: { [HOME]: [LOT] }, answer: gitlab(THREAD) })
  expect(await ui.find({ type: 'Button', key: 'act:treat:2962' } as never)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /autre session/ })).toBeDefined()
  await clock.advance(2 * 60_000)
  await clock.settle()
  expect(notes.filter(n => n.includes('!2962'))).toHaveLength(0)
  await ui.unmount()
})

test('Prendre on a bug nobody holds asks first, then claims it and opens its lot', async ($, on) => {
  const answer = (argv: string[], body: unknown) => {
    const url = argv.find(a => a.startsWith('URL='))?.slice(4) ?? ''
    if (argv[0] === 'git' && argv.includes('user.email')) return { stdout: 'younes.b@empowill.com' }
    if (url.startsWith('/v1/users')) return { stdout: JSON.stringify({ object: 'list', results: [{ id: 'me', type: 'person', person: { email: 'younes.b@empowill.com' } }] }) }
    if (url.includes('27f0ffb8')) return { stdout: JSON.stringify({ object: 'list', results: [{ id: 'scope-comp', url: 's', created_time: '', properties: { Name: { type: 'title', title: [{ plain_text: 'Compétence' }] }, Maintainer: { type: 'people', people: [{ id: 'me' }] } } }] }) }
    if (url === TICKETS && (body as { filter?: { and?: unknown } })?.filter?.and) return { stdout: JSON.stringify({ object: 'list', results: [page(4236, 'Autorisation de conduite', { priority: 'High' })] }) }
    return gitlab(GREEN, { 4236: page(4236, 'Autorisation de conduite', { priority: 'High' }) })(argv, body)
  }
  const { ui, calls } = await pane($, on, { answer })
  await ui.press({ key: 'act:take:ET-4236' })
  expect(ran(calls, 'task', 'dew-claim', 'ID=ET-4236')).toBe(false)
  await ui.press({ key: 'yes:take:ET-4236' })
  expect(ran(calls, 'task', 'dew-claim', 'ID=ET-4236')).toBe(true)
  await ui.unmount()
})

test('/menage go removes a merged lot with git alone, never forced, and no ccw', async ($, on) => {
  const answer = (argv: string[]) => (argv.includes('status') ? { stdout: `## ${LOT}...origin/${LOT}` } : argv[0] === 'git' && argv.includes('rev-parse') ? { stdout: `${ROOT}/.git` } : {})
  const { calls } = world(on, { dirs: { [HOME]: [LOT] }, answer })
  await $.session.start(START)
  await $.command.run({ command: 'menage', args: 'go', ...TYPED })
  expect(ran(calls, 'git', '-C', ROOT, 'worktree', 'remove', `${HOME}/${LOT}`)).toBe(true)
  expect(ran(calls, 'git', '-C', ROOT, 'branch', '-d', LOT)).toBe(true)
  expect(calls.some(c => c.argv[0] === 'ccw' || c.argv.includes('--force') || c.argv.includes('-D'))).toBe(false)
})
