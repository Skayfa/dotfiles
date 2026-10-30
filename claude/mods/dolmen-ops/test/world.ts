// The engine beneath the plugin, shared by every test: a Dolmen checkout, files, and commands
// answered by the test and recorded. A Notion body file the mod writes is readable by `answer`.
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const NOW = Date.parse('2026-10-30T10:00:00Z')

export const ROOT = '/w/dolmen'
export const HOME = '/w/dolmen-worktrees'

export type Call = { argv: string[]; cwd?: string }
export type Answer = { exitCode?: number; stdout?: string; stderr?: string }

export type World = {
  cwd?: string
  dirs?: Record<string, string[]>
  files?: Record<string, string>
  answer?: (argv: string[], body: unknown) => Answer
  calls?: Call[]
  prompts?: string[]
}

const entry = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })

export function world(on: On, w: World = {}) {
  const calls = (w.calls ??= [])
  const prompts = (w.prompts ??= [])
  const files = (w.files ??= { [`${ROOT}/cmd/dolmen/main.go`]: 'package main' })
  mock.env(on, { HOME: '/w', TMPDIR: '/tmp' })
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: w.cwd ?? ROOT }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 42 }], cost: { usd: 1 } } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__dolmen-ops__${e.name}` } }))
  on('agent.register', (_, e) => ({ value: { agent: `dolmen-ops:${e.name}` } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const notes: string[] = []
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: { isSent: true as const, channel: 'terminal_bell' as const } }
  })
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('fs.list', (_, e) => ({ value: (w.dirs?.[e.path] ?? []).map(entry) }))
  on('fs.exists', (_, e) => ({ value: files[e.path] !== undefined }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    calls.push({ argv, cwd: e.init?.cwd })
    const bodyArg = argv.find(a => a.startsWith('BODY='))
    const body = bodyArg ? JSON.parse(files[bodyArg.slice(5)] ?? 'null') : undefined
    const a = w.answer?.(argv, body) ?? {}
    return { value: { exitCode: a.exitCode ?? 0, stdout: a.stdout ?? '', stderr: a.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { calls, prompts, clock, notes }
}

export const START = { cwd: ROOT, surface: 'terminal', isInteractive: true } as const
export const TYPED = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }

export function ran(calls: Call[], ...words: string[]): boolean {
  return calls.some(c => words.every(w => c.argv.includes(w)))
}

// A Notion ticket page as the API returns it.
export function page(n: number, title: string, o: { status?: string; priority?: string; complexity?: string; type?: string; scopes?: string[]; assignees?: string[]; created?: string } = {}) {
  return {
    object: 'page',
    id: `page-${n}`,
    url: `https://app.notion.com/p/page-${n}`,
    created_time: o.created ?? '2026-10-01T09:00:00Z',
    properties: {
      ID: { type: 'unique_id', unique_id: { prefix: 'ET', number: n } },
      Title: { type: 'title', title: [{ plain_text: title }] },
      Status: { type: 'status', status: { name: o.status ?? 'Ready' } },
      Priority: { type: 'select', select: o.priority ? { name: o.priority } : null },
      Complexity: { type: 'select', select: { name: o.complexity ?? 'Simple' } },
      Type: { type: 'select', select: { name: o.type ?? 'Bug' } },
      Plan: { type: 'rich_text', rich_text: [{ plain_text: 'En tant que RH : archive → la compétence disparaît' }] },
      Scopes: { type: 'relation', relation: (o.scopes ?? ['scope-comp']).map(id => ({ id })) },
      Assignee: { type: 'people', people: (o.assignees ?? []).map(id => ({ id })) },
    },
  }
}
