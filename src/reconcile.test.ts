import { planReconcile } from './reconcile.ts'

function local(entries: Record<string, { hash: string; syncedHash?: string }>) {
  return new Map(Object.entries(entries))
}

function diffs(...items: { path: string; action: 'upload' | 'download' }[]) {
  return items
}

function assertEqual<T>(got: T, want: T, label: string): void {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g !== w) throw new Error(`${label}: got ${g}, want ${w}`)
}

function testRenameOrphanIsLocalDelete(): void {
  const plan = planReconcile(
    diffs(
      { path: 'old.md', action: 'upload' },
      { path: 'new.md', action: 'download' },
    ),
    local({
      'old.md': { hash: 'aaa', syncedHash: 'aaa' },
    }),
  )
  assertEqual(plan.uploads, [], 'uploads')
  assertEqual(plan.downloads, ['new.md'], 'downloads')
  assertEqual(plan.localDeletes, ['old.md'], 'localDeletes')
}

function testUnsyncedLocalFileStillUploads(): void {
  const plan = planReconcile(
    diffs({ path: 'draft.md', action: 'upload' }),
    local({ 'draft.md': { hash: 'bbb' } }),
  )
  assertEqual(plan.uploads, ['draft.md'], 'uploads')
  assertEqual(plan.localDeletes, [], 'localDeletes')
}

function testLocallyEditedOrphanStillUploads(): void {
  const plan = planReconcile(
    diffs({ path: 'old.md', action: 'upload' }),
    local({ 'old.md': { hash: 'edited', syncedHash: 'aaa' } }),
  )
  assertEqual(plan.uploads, ['old.md'], 'uploads')
  assertEqual(plan.localDeletes, [], 'localDeletes')
}

function testConflictedSkipped(): void {
  const plan = planReconcile(
    diffs({ path: 'old.md', action: 'upload' }),
    local({ 'old.md': { hash: 'aaa', syncedHash: 'aaa' } }),
    new Set(['old.md']),
  )
  assertEqual(plan.uploads, [], 'uploads')
  assertEqual(plan.localDeletes, [], 'localDeletes')
}

function testConflictCopyIgnored(): void {
  const plan = planReconcile(
    diffs({ path: 'n.conflict.md', action: 'upload' }),
    local({ 'n.conflict.md': { hash: 'x', syncedHash: 'x' } }),
  )
  assertEqual(plan.uploads, [], 'uploads')
  assertEqual(plan.localDeletes, [], 'localDeletes')
  assertEqual(plan.downloads, [], 'downloads')
}

const tests = [
  testRenameOrphanIsLocalDelete,
  testUnsyncedLocalFileStillUploads,
  testLocallyEditedOrphanStillUploads,
  testConflictedSkipped,
  testConflictCopyIgnored,
]

let failed = 0
for (const fn of tests) {
  try {
    fn()
    console.log('ok', fn.name)
  } catch (e) {
    failed++
    console.error('FAIL', fn.name, e)
  }
}
if (failed > 0) {
  process.exit(1)
}
console.log(`${tests.length} tests passed`)
