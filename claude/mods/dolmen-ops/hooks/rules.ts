// Pure rules of dolmen-ops: no `$`, so the tests can run them as they are.

// --- shell commands -------------------------------------------------------------------------------

// One shell command split into its simple commands (best effort: quotes are not parsed).
export function segments(command: string): string[][] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map(s => s.trim().split(/\s+/).filter(Boolean))
    .filter(s => s.length > 0)
}

// The subcommand of a tool (`git`, `glab`) in a segment and its arguments, global options skipped.
function call(seg: string[], tool: string): { sub: string; args: string[]; dir?: string } | undefined {
  const at = seg.findIndex(t => t === tool || t.endsWith(`/${tool}`))
  if (at < 0) return undefined
  let dir: string | undefined
  let i = at + 1
  while (i < seg.length && seg[i]!.startsWith('-')) {
    const opt = seg[i]!
    if (opt === '-C' || opt === '-c' || opt === '--git-dir' || opt === '--work-tree' || opt === '-R' || opt === '--repo') {
      if (opt === '-C') dir = seg[i + 1]
      i += 2
    } else i += 1
  }
  const sub = seg[i]
  return sub ? { sub, args: seg.slice(i + 1), dir } : undefined
}

const STAGE_ALL = new Set(['-A', '--all', '.', ':/', ':', '*', '--no-ignore-removal'])

const forced = (a: string) =>
  a === '--force' || a.startsWith('--force-with-lease') || a === '--force-if-includes' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || /^\+\S/.test(a)

// Why a command breaks the flow's rules, or undefined. `/pret` arms `glab mr update --ready` for one MR.
export function refusal(command: string, readyArmed: (mr: string) => boolean = () => false): string | undefined {
  for (const seg of segments(command)) {
    const git = call(seg, 'git')
    if (git?.sub === 'add' && git.args.some(a => STAGE_ALL.has(a))) {
      return 'dolmen-ops: `git add -A` / `git add .` also stage what other agents edit in this tree. Name the paths: `git add <file> <file>`.'
    }
    if (git?.sub === 'push' && git.args.some(forced)) {
      return 'dolmen-ops: never force-push. Merge main instead (`task merge`), then push.'
    }
    const glab = call(seg, 'glab')
    if (glab?.sub !== 'mr') continue
    const [verb, ...rest] = glab.args
    if (verb === 'merge' || verb === 'approve') {
      return `dolmen-ops: \`glab mr ${verb}\` is the team's gesture, never an agent's (babysit-mr-empowill).`
    }
    if (verb === 'update' && rest.includes('--ready')) {
      const mr = rest.find(a => /^!?\d+$/.test(a))?.replace('!', '')
      if (!mr || !readyArmed(mr)) return 'dolmen-ops: leaving Draft is the author\'s call. Younes types `/pret <mr>`, which checks the MR and allows it.'
    }
    if (verb === 'create') {
      if (!rest.includes('--draft')) return 'dolmen-ops: an MR opens as Draft (`glab mr create --draft`, open-mr-empowill).'
      if (rest.some(a => a === '--description' || a === '-d' || a.startsWith('--description=')) && !command.includes('Link to Notion ticket')) {
        return 'dolmen-ops: `--description` skips the MR template. Paste .gitlab/merge_request_templates/Default.md into it (the « Link to Notion ticket » section included).'
      }
    }
  }
  return undefined
}

// The repo of each `git commit --amend` in a command (its `-C` dir, else the leading `cd`).
export function amendIn(command: string): (string | undefined)[] {
  const out: (string | undefined)[] = []
  let cd: string | undefined
  for (const seg of segments(command)) {
    if (seg[0] === 'cd' && seg[1]) cd = seg[1]
    const git = call(seg, 'git')
    if (git?.sub === 'commit' && git.args.includes('--amend')) out.push(git.dir ?? cd)
  }
  return out
}

export const AMEND_REFUSAL = 'dolmen-ops: HEAD is already pushed, so `--amend` would rewrite a published commit. Make a new commit.'

// Commands whose output is long and mostly noise.
const NOISY = /\b(task (test-pkg|test-go|test-front|lint|lint-go|lint-js|recette|bench-willy-light)|go test|golangci-lint|pnpm (run )?(test|lint)|vitest)\b/

export const KEEP_WHOLE_LINES = 150

export function shouldTrim(command: string, runInBackground?: boolean): boolean {
  return !runInBackground && NOISY.test(command) && !command.includes('dolmen-ops: full log')
}

// Output to a file, and only the useful part to the model: all of it when short, else its start,
// the failure lines and its end, and the log's path. The exit code is the command's own; the
// command runs in a subshell, so an `exit` in it still leaves the trimming to run.
export function wrapForTrim(command: string): string {
  return [
    '__do_log=$(mktemp "${TMPDIR:-/tmp}/dolmen-ops.XXXXXX")',
    '(',
    command,
    ') >"$__do_log" 2>&1; __do_rc=$?',
    '__do_n=$(wc -l <"$__do_log" | tr -d " ")',
    `if [ "$__do_n" -le ${KEEP_WHOLE_LINES} ]; then cat "$__do_log"; else`,
    '  head -n 20 "$__do_log"',
    '  echo "[dolmen-ops] $__do_n lines; failures:"',
    "  grep -n -E -- '--- FAIL|FAIL|panic:|Error|ERROR|error:|✘|✗|❌' \"$__do_log\" | head -n 60",
    '  echo "[dolmen-ops] last lines:"',
    '  tail -n 40 "$__do_log"',
    'fi',
    'echo "[dolmen-ops: full log $__do_log, exit $__do_rc]"',
    '(exit $__do_rc)',
  ].join('\n')
}

// --- tickets --------------------------------------------------------------------------------------

export type DewTicket = { id: string; priority: string; boost: string; type: string; complexity: string; title: string; url: string }

// `task dew` (cmd/dolmen dew list): a tabwriter of 7 columns, at least two spaces between them,
// `-` for an empty value: ID, Priority, boost, Type, Complexity, Title, URL.
export function parseDew(out: string): DewTicket[] {
  return out
    .split('\n')
    .map(l => l.trim().split(/\s{2,}/))
    .filter(c => c.length >= 7 && /^ET-\d+$/.test(c[0]!))
    .map(c => {
      const [id, priority, boost, type, complexity] = c as [string, string, string, string, string]
      return { id, priority, boost, type, complexity, title: c.slice(5, -1).join('  '), url: c[c.length - 1]! }
    })
}

// Every ET id a text names (ET-4042, et_4042, [ET-3844]), in order, once.
export function ticketIds(text: string): string[] {
  const ids = [...text.matchAll(/\bET[-_](\d{1,6})\b/gi)].map(m => `ET-${m[1]}`)
  return [...new Set(ids)]
}

export function slugify(text: string, max = 40): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
}

// One lot, one branch: `ET-4449-ET-4481-competences` (the ids are what links the MR to its tickets).
export function branchFor(ids: readonly string[], title: string): string {
  const slug = slugify(title)
  return [...ids, ...(slug ? [slug] : [])].join('-')
}

// The tickets a branch carries.
export function idsOfBranch(branch: string): string[] {
  return ticketIds(branch.replace(/^origin\//, ''))
}

export const LOT_MAX = 4

// Why a ticket should not join a lot, or undefined. The caller asks the owner to confirm.
export function lotObjection(lot: readonly { scopes: string[] }[], add: { priority: string; complexity: string; scopes: string[] }): string | undefined {
  if (lot.length >= LOT_MAX) return `le lot a déjà ${LOT_MAX} tickets`
  if (add.priority === 'Critical') return 'un Critical sort seul, vite'
  if (add.complexity === 'Hard' || add.complexity === 'Killer') return `un ticket ${add.complexity} sort seul`
  const scopes = new Set(lot.flatMap(t => t.scopes))
  if (scopes.size && add.scopes.length && !add.scopes.some(s => scopes.has(s))) return 'il est d\'un autre scope (un autre relecteur)'
  return undefined
}

// --- bugs and their SLO (DEW page, « proposé », in working days) ----------------------------------

export const SLO_DAYS: Record<string, number> = { Critical: 3, High: 15, Low: 30 }

// Working days (Monday to Friday) from one instant to the next, whole days only.
export function workingDays(fromMs: number, toMs: number): number {
  let n = 0
  const day = 86_400_000
  for (let t = Math.floor(fromMs / day) * day + day; t <= toMs; t += day) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) n += 1
  }
  return n
}

export type Bug = { id: string; title: string; url?: string; status: string; priority: string; createdMs: number; assignees: string[]; mine: boolean; scopes: string[] }

export type SloView = { age: number; limit?: number; late: boolean }

export function slo(bug: Pick<Bug, 'priority' | 'createdMs'>, nowMs: number): SloView {
  const age = workingDays(bug.createdMs, nowMs)
  const limit = SLO_DAYS[bug.priority]
  return { age, limit, late: limit !== undefined && age > limit }
}

const RANK: Record<string, number> = { Critical: 0, High: 1, Low: 2 }

// Mine first, then the most over its SLO, then the oldest.
export function sortBugs(bugs: readonly Bug[], nowMs: number): Bug[] {
  const over = (b: Bug) => {
    const s = slo(b, nowMs)
    return s.limit ? s.age / s.limit : 0
  }
  return [...bugs].sort((a, b) => Number(b.mine) - Number(a.mine) || (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || over(b) - over(a) || a.createdMs - b.createdMs)
}

// --- MRs: mrwatch's digest ------------------------------------------------------------------------

export type Digest = {
  events: string[]
  state?: string
  pipeline?: string
  failed: string[]
  conflicts: boolean
  draft: boolean
  openThreads: number
  threads: { author: string; where: string; body: string }[]
}

const EVENT = /^(CI_FAILED|CONFLICT|NEW_NOTES|DRAFT_NOTES|READY|GREEN|PIPELINE_|MERGED|CLOSED|ACK)/

// `go run ./.agents/skills/babysit-mr-empowill/mrwatch -mr <iid>`: an events line when something is
// new since the last -ack, the status line `state=… pipeline=… failed=… conflicts=… draft=… open_threads=…`,
// then one line per open thread `<id8> <author> <path>:<line> | <body>`.
export function parseDigest(out: string): Digest {
  const d: Digest = { events: [], failed: [], conflicts: false, draft: false, openThreads: 0, threads: [] }
  for (const line of out.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (/^state=/.test(line)) {
      const kv = Object.fromEntries(line.split(/\s+/).map(p => p.split('=') as [string, string]))
      d.state = kv.state
      d.pipeline = kv.pipeline
      d.failed = kv.failed && kv.failed !== '-' ? kv.failed.split(',') : []
      d.conflicts = kv.conflicts === 'true'
      d.draft = kv.draft === 'true'
      d.openThreads = Number(kv.open_threads ?? 0)
    } else if (line.split(/\s+/).every(t => EVENT.test(t))) {
      d.events.push(...line.split(/\s+/).filter(t => t !== 'ACK'))
    } else {
      const m = /^[0-9a-f]{4,8}\s+(\S+)\s+(\S*)\s*\|\s*(.*)$/.exec(line)
      if (m) d.threads.push({ author: m[1]!, where: m[2]!, body: m[3]! })
    }
  }
  return d
}

// The events worth waking the session for: something the author, a reviewer or the CI asks of us.
export function wakingEvents(d: Digest): string[] {
  return d.events.filter(e => /^(CI_FAILED|CONFLICT|NEW_NOTES)/.test(e))
}

// One MR's line in the panel.
export function mrValue(d: Digest): { value: string; tone: 'success' | 'warning' | 'error' | 'subtle' } {
  if (d.state === 'merged' || d.events.includes('MERGED')) return { value: 'mergée', tone: 'subtle' }
  const parts: string[] = []
  const red = d.pipeline === 'failed' || d.failed.length > 0
  const label: Record<string, string> = { success: '● vert', running: '● en cours', pending: '● en attente', canceled: '● annulée', none: 'pas de pipeline' }
  parts.push(red ? `● rouge${d.failed.length ? ` · ${d.failed.slice(0, 2).join(', ')}` : ''}` : (label[d.pipeline ?? ''] ?? `● ${d.pipeline ?? '?'}`))
  if (d.conflicts) parts.push('conflit')
  if (d.openThreads) parts.push(`${d.openThreads} fil${d.openThreads > 1 ? 's' : ''}`)
  if (d.draft) parts.push('Draft')
  return { value: parts.join(' · '), tone: red || d.conflicts ? 'error' : d.openThreads ? 'warning' : 'success' }
}

// The prompt that wakes the session on an MR's events: the babysit skill does the work.
export function babysitPrompt(iid: number, title: string, d: Digest): string {
  const threads = d.threads.slice(0, 8).map(t => `- ${t.author} ${t.where} | ${t.body}`)
  return [
    `[dolmen-ops] !${iid} ${title} : ${wakingEvents(d).join(' ')}.`,
    ...threads,
    `Passe !${iid} au skill babysit-mr-empowill : les commentaires d'abord, puis CodeRabbit, puis la CI, un seul push pour le lot de corrections, puis \`mrwatch -mr ${iid} -ack\`.`,
    'Les sous-agents de correction tournent en Sonnet ; la lecture des logs en Haiku (agent dolmen-ops:runner).',
  ].join('\n')
}

// --- time, quota ----------------------------------------------------------------------------------

// An age the way people say it: 12 min, 21 h, 3 j.
export function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} j`
}

export const QUOTA_WARN = 90

export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export function highLimits(limits: readonly Limit[]): { key: string; text: string }[] {
  return limits
    .filter(l => l.percentUsed >= QUOTA_WARN)
    .map(l => ({ key: `${l.kind}@${l.resetsAt ?? ''}`, text: `${l.kind.replace('_', ' ')} ${Math.round(l.percentUsed)} %` }))
}

export const HANDOFF_SECTION =
  'dolmen-ops: the plan quota is past 90 %. The session can stop mid-turn without warning. ' +
  'Commit, push the lot branch once (one pipeline), and update the « État » section of its Draft MR: done / left / next command.'

// The models, by kind of work (vision page, « un modèle par tâche »): one short line every turn.
export const MODELS_SECTION =
  'dolmen-ops: subagents run on the lightest model that does the job: Haiku (agent dolmen-ops:runner) to run tests, the recette and read logs; ' +
  'Sonnet for routine code and babysit fixes; this model for /plan, /epic and Hard code. Read a ticket with the tool ticket_card, never the raw Notion page. ' +
  'Read the recette verdict as text; open a capture only for a ❌ criterion.'
