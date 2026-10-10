# A test that throws is not reported as a failure, and stops the run

**Status:** needs-triage
**Blocked by:** None
**Touches:** `index.js` (`Test.run`, `TestRunner.run`,
`rethrowImmediate`), `test/`

## Problem

When a test function throws (or its returned promise rejects), tapzero
does not print a `not ok` line for it. The error propagates out of
`Test.run` (`index.js:350-354`), which makes `TestRunner.run` reject in
its loop (`index.js:511-512`). `TestRunner.add` hands that rejection to
`rethrowImmediate` (`index.js:488-492`, `629-636`), which rethrows it
from a `setTimeout`.

As a result:

- The failing test gets no `not ok` line. The only record of the
  failure is a stack trace on stderr (Node) or an uncaught error in the
  page (browser).
- Every test after it is skipped.
- The run never prints the `1..N` plan or the `# tests` / `# pass` /
  `# fail` summary.
- `onFinish` callbacks never run.

The same path handles tapzero's own plan errors, because they are also
raised with `throw` inside `Test.run` (`index.js:360-375`):
`Test timed out after ... ms`, `Test ended before the planned number`,
and `More tests than planned` (`index.js:259-261`, `521-523`). A plan
mismatch is therefore reported the same way: no `not ok`, and the run
stops.

## Reproduction

Node 26, tapzero 0.10.16 (`index.js` on branch `fork`, b7fae5a):

```js
// repro.mjs
import { test } from '@substrate-system/tapzero'

test('first test passes', t => {
    t.ok(true, 'before the throw')
})

test('second test throws', async t => {
    t.ok(true, 'an assertion before the throw')
    await Promise.resolve()
    throw new Error('boom from inside a test')
})

test('third test never runs', t => {
    t.ok(true, 'after the throw')
})
```

```sh
node repro.mjs; echo "exit=$?"
```

stdout:

```
TAP version 13
# first test passes
ok 1 before the throw
# second test throws
ok 2 an assertion before the throw
```

stderr: the stack for `Error: boom from inside a test`, rethrown from
`function rethrow () { throw err }` (`index.js:635`). Exit code 1.

There is no `not ok`, test 3 is missing, and there is no plan line.
Piped through tap-spec, the output shows two passing assertions and
nothing else, and tap-spec exits 1 only because the plan line is
missing. Nothing in the report names the failure.

Plan mismatch, same result:

```js
test('planned two, made one', t => {
    t.plan(2)
    t.ok(true, 'only assertion')
})

test('runs after the plan failure?', t => {
    t.ok(true, 'after')
})
```

stdout stops at `ok 1 only assertion`. After 5000 ms, stderr shows
`Error: Test timed out after 5000 ms`, the second test never runs, and
the exit code is 1.

## Impact in a browser runner

Under tapout (a browser runner that reads tapzero's TAP from the page),
the rethrown error becomes an uncaught page error. tapout's harness
treats that as "tests finished". In
`@substrate-system/blur-hash`, a `waitFor` that rejected inside a test
produced only:

```
Unhandled error: Error: A visible selector was not found after 800ms ...
Error running tests: Error: Tests failed
```

The exit code was 1, but there was no `not ok` line and none of the
later tests ran. When the failing call is a wait that hangs instead of
throwing, tapout's idle auto-finish ends the run with exit 0. blur-hash
works around both by making every wait resolve `null` on timeout, so the
test can assert on it. Every consumer has to know to do that.

## Expected

A test that throws is one failing test:

```
# second test throws
ok 2 an assertion before the throw
not ok 3 boom from inside a test
  ---
    operator: error
    ...
  ...
# third test never runs
ok 4 after the throw

1..4
# tests 4
# pass  3
# fail  1
```

The run continues, the plan and summary are printed, `onFinish` runs
with `fail: 1`, and the process exits non-zero through the existing
`fail` check (`index.js:547-556`). Plan mismatches are reported the same
way, as a `not ok` for the test that missed its plan.

## Suggested fix

- In `Test.run`, wrap the call to `this.fn(this)` and the `await` of
  its promise in try/catch. On a caught error, record a failure through
  the existing `_assert` path (`index.js:247`), for example
  `this._assert(false, err, undefined, err.message, 'error')`, so it
  gets an id, a `not ok` line, the YAML block and a `_result.fail`
  increment. Then finish the test normally.
- Report the plan checks (`index.js:360-375`) through `_assert` too,
  instead of throwing.
- `_assert` throws for an assertion after `done` and for "more tests
  than planned" (`index.js:251-261`). Decide whether those should also
  become `not ok` lines; at least, a test that throws after its plan is
  satisfied should still be reported.
- Keep `rethrowExceptions` for errors in the runner itself, not for
  errors raised by a test.

## Open question (why this is needs-triage)

Crashing on an exception may be intentional: tape and the original
raynos/tapzero both let a thrown error crash the process, and
`rethrowExceptions` defaults to `true`. If the crash is wanted, a middle
ground is to print a `not ok` line for the thrown test and the plan
footer first, then rethrow. That keeps the crash but gives TAP
consumers a named failure.

## Acceptance criteria

- [ ] A test whose function throws synchronously produces one `not ok`
  line naming the error, and the next test still runs.
- [ ] Same for a test whose returned promise rejects.
- [ ] A `t.plan(n)` mismatch (too few assertions, or a plan timeout)
  produces a `not ok` line for that test, and the next test still runs.
- [ ] After a throwing test, the run prints `1..N` and the summary with
  the correct `# fail` count, and `onFinish` receives `fail >= 1`.
- [ ] Under Node, the process exits 1 when a test threw.

## Comments

Found while hardening the browser tests in
`@substrate-system/blur-hash` (branch `no-partial-paint`). That repo's
`AGENTS.md` documents the workaround (`waitBounded` / `settlesInTime`).
