// The one place that runs commands against Dolmen: git, the repo's own tasks (`task dew`,
// `task notion-api`), glab and mrwatch. Everything else reads through it.
import type { EngineInterface } from 'claude-code'
import { idsOfBranch, parseDew, parseDigest, ticketIds, type Bug, type DewTicket, type Digest } from './rules.ts'

export const PROJECT = 'empowill%2Fdolmen'
const TICKETS_DS = '1280ffb8-c088-8185-8688-000b4b3beb07'
const SCOPES_DS = '27f0ffb8-c088-804c-903f-000bed799695'
const MRWATCH = './.agents/skills/babysit-mr-empowill/mrwatch'

export type Ran = { ok: boolean; out: string; err: string }

// A command by argv; never throws, so callers read `ok` instead of catching.
export async function sh($: EngineInterface, argv: readonly string[], cwd?: string): Promise<Ran> {
  const r = await $.process.run(argv, cwd ? { cwd } : undefined).catch((e: unknown) => ({ exitCode: -1, stdout: '', stderr: String(e) }))
  return { ok: r.exitCode === 0, out: r.stdout.trim(), err: r.stderr.trim() }
}

function json<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

// --- where Dolmen is ------------------------------------------------------------------------------

// The main checkout of Dolmen holding `dir` (a worktree's too), or undefined outside Dolmen.
export async function dolmenRoot($: EngineInterface, dir: string): Promise<string | undefined> {
  const env = await $.env.get('DOLMEN_DIR')
  const common = await sh($, ['git', '-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  const candidates = [env, common.ok ? common.out.replace(/\/\.git\/?$/, '') : undefined].filter((d): d is string => !!d)
  for (const root of candidates) {
    if (await $.fs.exists(`${root}/cmd/dolmen/main.go`).catch(() => false)) return root
  }
  return undefined
}

// ccw's layout: <parent>/<repo>-worktrees/<branch>, or $CCW_HOME.
export async function worktreesHome($: EngineInterface, root: string): Promise<string> {
  const home = await $.env.get('CCW_HOME')
  if (home) return home
  const parent = root.replace(/\/[^/]+\/?$/, '')
  return `${parent}/${root.split('/').pop()}-worktrees`
}

// --- git ------------------------------------------------------------------------------------------

export type Status = { branch?: string; upstream?: string; ahead: number; dirty: number }

export function parseStatus(out: string): Status {
  const [head = '', ...files] = out.split('\n').filter(l => l.trim())
  const m = /^## ([^.\s]+)(?:\.\.\.(\S+))?(?: \[(.*)\])?/.exec(head)
  return { branch: m?.[1], upstream: m?.[2], ahead: Number(/ahead (\d+)/.exec(m?.[3] ?? '')?.[1] ?? 0), dirty: files.length }
}

export async function gitStatus($: EngineInterface, dir: string): Promise<Status | undefined> {
  const r = await sh($, ['git', '-C', dir, 'status', '--porcelain=v1', '-b'])
  return r.ok ? parseStatus(r.out) : undefined
}

export async function inMain($: EngineInterface, dir: string): Promise<boolean> {
  return (await sh($, ['git', '-C', dir, 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'])).ok
}

// The ticket worktrees: every folder of the worktrees home whose branch names an ET id.
export async function lotDirs($: EngineInterface, root: string): Promise<{ dir: string; name: string }[]> {
  const home = await worktreesHome($, root)
  return (await $.fs.list(home).catch(() => [])).filter(e => e.kind === 'dir' && ticketIds(e.name).length > 0).map(e => ({ dir: `${home}/${e.name}`, name: e.name }))
}

// --- the repo's own tasks -------------------------------------------------------------------------

export async function dewList($: EngineInterface, root: string): Promise<DewTicket[] | undefined> {
  const r = await sh($, ['task', 'dew'], root)
  return r.ok ? parseDew(r.out) : undefined
}

// `dolmen dew claim`: Ready → In Progress, assigned to me; refuses a ticket someone else holds.
export async function dewClaim($: EngineInterface, root: string, id: string): Promise<Ran> {
  return sh($, ['task', 'dew-claim', `ID=${id}`], root)
}

// `task notion-api`: the token stays in ~/.dolmen/.envprivate; a body goes through a file.
export async function notion<T>($: EngineInterface, root: string, method: string, url: string, body?: unknown): Promise<T | undefined> {
  const argv = ['task', 'notion-api', `METHOD=${method}`, `URL=${url}`]
  if (body !== undefined) {
    const file = `${(await $.env.get('TMPDIR')) ?? '/tmp'}/dolmen-ops-${Math.random().toString(36).slice(2)}.json`
    await $.fs.write(file, JSON.stringify(body))
    argv.push(`BODY=${file}`)
  }
  const r = await sh($, argv, root)
  const out = r.ok ? json<T & { object?: string }>(r.out) : undefined
  return out?.object === 'error' ? undefined : out
}

// --- Notion tickets -------------------------------------------------------------------------------

type Prop = {
  type: string
  title?: { plain_text: string }[]
  rich_text?: { plain_text: string }[]
  select?: { name: string } | null
  status?: { name: string } | null
  people?: { id: string }[]
  relation?: { id: string }[]
  formula?: { string?: string | null }
  unique_id?: { prefix?: string | null; number: number }
  created_time?: string
}
type Page = { id: string; url: string; created_time: string; properties: Record<string, Prop> }

const text = (p?: Prop) => (p?.title ?? p?.rich_text ?? []).map(t => t.plain_text).join('')
const name = (p?: Prop) => p?.select?.name ?? p?.status?.name ?? ''
const ids = (p?: Prop) => (p?.people ?? p?.relation ?? []).map(x => x.id)
const etId = (p?: Prop) => (p?.unique_id ? `${p.unique_id.prefix ?? 'ET'}-${p.unique_id.number}` : '')

export type Card = {
  id: string
  pageId: string
  url: string
  title: string
  status: string
  priority: string
  type: string
  complexity: string
  epic: string
  plan: string
  body: string
  scopes: string[]
}

const BODY_MAX = 6000

type Block = { type: string; has_children?: boolean } & Record<string, { rich_text?: { plain_text: string }[] } | unknown>

// The page's blocks as plain text (one level): headings, paragraphs, lists, quotes, callouts, code.
async function pageText($: EngineInterface, root: string, pageId: string): Promise<string> {
  const r = await notion<{ results: Block[] }>($, root, 'GET', `/v1/blocks/${pageId}/children?page_size=100`)
  const lines = (r?.results ?? []).map(b => {
    const v = b[b.type] as { rich_text?: { plain_text: string }[] } | undefined
    const t = (v?.rich_text ?? []).map(x => x.plain_text).join('')
    if (b.type.startsWith('heading')) return `## ${t}`
    if (b.type.endsWith('list_item')) return `- ${t}`
    if (b.type === 'image' || b.type === 'file') return `[${b.type}]`
    return t
  })
  const all = lines.filter(Boolean).join('\n')
  return all.length > BODY_MAX ? `${all.slice(0, BODY_MAX)}\n… (coupé à ${BODY_MAX} caractères)` : all
}

function card(p: Page, body = ''): Card {
  const q = p.properties
  return {
    id: etId(q.ID),
    pageId: p.id,
    url: p.url,
    title: text(q.Title),
    status: name(q.Status),
    priority: name(q.Priority),
    type: name(q.Type),
    complexity: name(q.Complexity),
    epic: q['Epic name']?.formula?.string ?? '',
    plan: text(q.Plan),
    body,
    scopes: ids(q.Scopes),
  }
}

export async function findTicket($: EngineInterface, root: string, id: string, withBody = false): Promise<Card | undefined> {
  const n = Number(/\d+/.exec(id)?.[0])
  const r = await notion<{ results: Page[] }>($, root, 'POST', `/v1/data_sources/${TICKETS_DS}/query`, {
    filter: { property: 'ID', unique_id: { equals: n } },
    page_size: 1,
  })
  const page = r?.results[0]
  if (!page) return undefined
  return card(page, withBody ? await pageText($, root, page.id) : '')
}

// The compact card the model reads instead of the raw page (≈ 1 k tokens instead of ≈ 10 k).
export function cardText(c: Card): string {
  return [
    `${c.id} · ${c.title}`,
    `${c.type || '-'} · ${c.priority || '-'} · ${c.complexity || '-'} · ${c.status}${c.epic ? ` · epic ${c.epic}` : ''}`,
    c.url,
    '',
    '## Plan',
    c.plan || '(vide : /plan le propose)',
    ...(c.body ? ['', '## Page', c.body] : []),
  ].join('\n')
}

export async function setStatus($: EngineInterface, root: string, pageId: string, status: string): Promise<boolean> {
  const r = await notion<Page>($, root, 'PATCH', `/v1/pages/${pageId}`, { properties: { Status: { status: { name: status } } } })
  return !!r
}

// My Notion user: the person whose email is git's (what `dolmen dew` uses too).
export async function notionMe($: EngineInterface, root: string): Promise<string | undefined> {
  const email = (await sh($, ['git', '-C', root, 'config', 'user.email'])).out.toLowerCase()
  if (!email) return undefined
  let cursor: string | undefined
  for (let page = 0; page < 10; page++) {
    const r = await notion<{ results: { id: string; type: string; person?: { email?: string } }[]; next_cursor?: string | null }>(
      $,
      root,
      'GET',
      `/v1/users?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`,
    )
    const me = r?.results.find(u => u.person?.email?.toLowerCase() === email)
    if (me) return me.id
    if (!r?.next_cursor) return undefined
    cursor = r.next_cursor
  }
  return undefined
}

export type Scope = { id: string; name: string; role: 'Lead' | 'Maintainer' | 'En formation' }

export async function myScopes($: EngineInterface, root: string, me: string): Promise<Scope[]> {
  const roles = ['Lead', 'Maintainer', 'En formation'] as const
  const r = await notion<{ results: Page[] }>($, root, 'POST', `/v1/data_sources/${SCOPES_DS}/query`, {
    filter: { or: roles.map(role => ({ property: role, people: { contains: me } })) },
    page_size: 100,
  })
  return (r?.results ?? []).map(p => {
    const title = Object.values(p.properties).find(v => v.type === 'title')
    const role = roles.find(ro => ids(p.properties[ro]).includes(me)) ?? 'Maintainer'
    return { id: p.id, name: text(title), role }
  })
}

// Open bugs assigned to me or in a scope I lead or maintain.
export async function myBugs($: EngineInterface, root: string, me: string, scopes: readonly Scope[]): Promise<Bug[] | undefined> {
  const owned = scopes.filter(s => s.role !== 'En formation')
  const r = await notion<{ results: Page[] }>($, root, 'POST', `/v1/data_sources/${TICKETS_DS}/query`, {
    filter: {
      and: [
        { property: 'Type', select: { equals: 'Bug' } },
        { property: 'Status', status: { does_not_equal: 'Done' } },
        { property: 'Status', status: { does_not_equal: 'Rejected' } },
        { or: [{ property: 'Assignee', people: { contains: me } }, ...owned.map(s => ({ property: 'Scopes', relation: { contains: s.id } }))] },
      ],
    },
    page_size: 100,
  })
  if (!r) return undefined
  const scopeName = new Map(scopes.map(s => [s.id, s.name]))
  return r.results.map(p => {
    const c = card(p)
    const assignees = ids(p.properties.Assignee)
    return {
      id: c.id,
      title: c.title,
      url: c.url,
      status: c.status,
      priority: c.priority,
      createdMs: Date.parse(p.created_time),
      assignees,
      mine: assignees.includes(me),
      scopes: c.scopes.map(s => scopeName.get(s) ?? '?'),
    }
  })
}

// --- GitLab ---------------------------------------------------------------------------------------

export type MR = { iid: number; title: string; draft: boolean; branch: string; author: string; url: string; updatedAt: string; tickets: string[] }

type RawMR = { iid: number; title: string; draft?: boolean; work_in_progress?: boolean; source_branch: string; author: { username: string }; web_url: string; updated_at: string }

function mr(m: RawMR): MR {
  return {
    iid: m.iid,
    title: m.title,
    draft: !!(m.draft ?? m.work_in_progress),
    branch: m.source_branch,
    author: m.author.username,
    url: m.web_url,
    updatedAt: m.updated_at,
    tickets: [...new Set([...ticketIds(m.title), ...idsOfBranch(m.source_branch)])],
  }
}

export async function glabMe($: EngineInterface): Promise<string | undefined> {
  const r = await sh($, ['glab', 'api', 'user'])
  return r.ok ? json<{ username: string }>(r.out)?.username : undefined
}

export async function myMRs($: EngineInterface): Promise<MR[] | undefined> {
  const r = await sh($, ['glab', 'api', `projects/${PROJECT}/merge_requests?state=opened&scope=created_by_me&per_page=50`])
  return r.ok ? (json<RawMR[]>(r.out) ?? []).map(mr) : undefined
}

export async function reviewMRs($: EngineInterface, me: string): Promise<MR[] | undefined> {
  const r = await sh($, ['glab', 'api', `projects/${PROJECT}/merge_requests?state=opened&scope=all&reviewer_username=${me}&per_page=50`])
  return r.ok ? (json<RawMR[]>(r.out) ?? []).map(mr) : undefined
}

export async function pipelineCount($: EngineInterface, iid: number): Promise<number | undefined> {
  const r = await sh($, ['glab', 'api', `projects/${PROJECT}/merge_requests/${iid}/pipelines?per_page=100`])
  return r.ok ? (json<unknown[]>(r.out) ?? []).length : undefined
}

// mrwatch, built once per session from the main checkout (`go run` compiles at every call).
export async function buildMrwatch($: EngineInterface, root: string): Promise<string[]> {
  const bin = `${(await $.env.get('TMPDIR')) ?? '/tmp'}/dolmen-ops-mrwatch`
  const built = await sh($, ['go', 'build', '-o', bin, MRWATCH], root)
  return built.ok ? [bin] : ['go', 'run', MRWATCH]
}

// The read-only digest: events since the last -ack, status, open threads. It remembers nothing.
export async function digest($: EngineInterface, root: string, mrwatch: readonly string[], iid: number): Promise<Digest | undefined> {
  const r = await sh($, [...mrwatch, '-mr', String(iid)], root)
  return r.ok ? parseDigest(r.out) : undefined
}

