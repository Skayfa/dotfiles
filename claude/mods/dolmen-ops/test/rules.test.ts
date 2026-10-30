import { expect, test } from 'claude-code/testing'
import { branchFor, lotObjection, parseDew, parseDigest, refusal, slo, sortBugs, ticketIds, wakingEvents, workingDays, type Bug } from '../hooks/rules.ts'

const DEW = [
  'ET-4236  Critical  -                 Bug       Medium     [Bug] Génération autorisation de conduite  https://app.notion.com/p/a',
  'ET-3945  High      boost 2026-10-20  Frontend  One liner  Champs personnalisés  mini fixes          https://app.notion.com/p/b',
].join('\n')

const DIGEST = [
  'NEW_NOTES:2:teo.m1,coderabbitai CI_FAILED:lint-go',
  'state=opened pipeline=failed pending=0 failed=lint-go conflicts=false draft=true open_threads=2 draft_notes=0',
  '3f2a91bc teo.m1 go/api/syn/users.go:840 | Pourquoi pas ListUsers ici ?',
  'a1b2c3d4 coderabbitai app/apps/x.tsx:12 | Missing key prop',
].join('\n')

test('the dew list, the mrwatch digest and the ticket ids are read', () => {
  const dew = parseDew(DEW)
  expect(dew.map(d => d.id)).toEqual(['ET-4236', 'ET-3945'])
  expect(dew[1]!.complexity).toBe('One liner')
  expect(dew[1]!.title).toBe('Champs personnalisés  mini fixes')
  const d = parseDigest(DIGEST)
  expect(d.pipeline).toBe('failed')
  expect(d.failed).toEqual(['lint-go'])
  expect(d.openThreads).toBe(2)
  expect(d.threads[0]).toEqual({ author: 'teo.m1', where: 'go/api/syn/users.go:840', body: 'Pourquoi pas ListUsers ici ?' })
  expect(wakingEvents(d)).toEqual(['NEW_NOTES:2:teo.m1,coderabbitai', 'CI_FAILED:lint-go'])
  expect(wakingEvents(parseDigest('GREEN\nstate=opened pipeline=success failed=- conflicts=false draft=true open_threads=0'))).toEqual([])
  expect(ticketIds('[ET-4449][et_4481] x ET-4449')).toEqual(['ET-4449', 'ET-4481'])
  expect(branchFor(['ET-4449', 'ET-4481'], '[Compétences] Archiver / exporter !')).toBe('ET-4449-ET-4481-archiver-exporter')
})

test('a lot keeps one scope, four tickets and no Critical or Hard one', () => {
  const lot = [{ scopes: ['comp'] }]
  expect(lotObjection(lot, { priority: 'High', complexity: 'Simple', scopes: ['comp'] })).toBeUndefined()
  expect(lotObjection(lot, { priority: 'Critical', complexity: 'Simple', scopes: ['comp'] })).toContain('Critical')
  expect(lotObjection(lot, { priority: 'High', complexity: 'Hard', scopes: ['comp'] })).toContain('Hard')
  expect(lotObjection(lot, { priority: 'High', complexity: 'Simple', scopes: ['plan'] })).toContain('autre scope')
  expect(lotObjection([lot[0]!, lot[0]!, lot[0]!, lot[0]!], { priority: 'Low', complexity: 'Simple', scopes: ['comp'] })).toContain('4')
})

test('bugs are aged in working days against their SLO, mine and the latest first', () => {
  const thu = Date.parse('2026-10-29T10:00:00Z')
  expect(workingDays(Date.parse('2026-10-23T10:00:00Z'), thu)).toBe(4) // Fri → Thu: Mon, Tue, Wed, Thu
  const bug = (id: string, priority: string, created: string, mine = false): Bug => ({ id, title: id, status: 'Ready', priority, createdMs: Date.parse(created), assignees: [], mine, scopes: [] })
  expect(slo(bug('a', 'Critical', '2026-09-29T09:00:00Z'), thu)).toEqual({ age: 22, limit: 3, late: true })
  const sorted = sortBugs([bug('low', 'Low', '2026-01-01T00:00:00Z'), bug('high', 'High', '2026-10-27T00:00:00Z'), bug('mine', 'High', '2026-10-28T00:00:00Z', true)], thu)
  expect(sorted.map(b => b.id)).toEqual(['mine', 'high', 'low'])
})

test('the gestures reserved to the author and the git moves that lose work are refused', () => {
  for (const c of ['git add -A', 'git push --force-with-lease', 'git push origin +ET-1-x', 'glab mr merge 2961', 'glab mr approve 2961', 'glab mr update 2961 --ready', 'glab mr create --title x', 'glab mr create --draft --description "hello"']) {
    expect(refusal(c)).toContain('dolmen-ops')
  }
  expect(refusal('glab mr update 2961 --ready', mr => mr === '2961')).toBeUndefined()
  expect(refusal('glab mr update 2962 --ready', mr => mr === '2961')).toContain('pret')
  expect(refusal('glab mr create --draft --title "[ET-1] x" --description "## Link to Notion ticket\n[ET-1](u)"')).toBeUndefined()
  expect(refusal('git add go/a.go && git commit -m x && git push -u origin ET-1-x')).toBeUndefined()
})
