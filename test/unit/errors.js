'use strict'

// @ts-check

import test from '@pre-bundled/tape'
import { TestRunner } from '../../index.js'

/**
 * Run the given tests in a fresh runner, and resolve with the reported
 * lines and the onFinish result.
 *
 * @param {Array<[string, import('../../index.js').TestFn]>} cases
 * @returns {Promise<{
 *   lines: string[],
 *   result: { total: number, success: number, fail: number }
 * }>}
 */
function runCases (cases) {
  return new Promise((resolve) => {
    /** @type {string[]} */
    const lines = []
    const h = new TestRunner((line) => { lines.push(line) })
    for (const [name, fn] of cases) {
      h.add(name, fn, false)
    }
    h.onFinish((result) => resolve({ lines, result }))
  })
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
function notOkLines (lines) {
  return lines.filter((line) => /^not ok \d+ /.test(line))
}

test('a test that throws is reported as not ok', async (assert) => {
  const { lines, result } = await runCases([
    ['throws', () => { throw new Error('boom') }],
    ['after', (t) => { t.ok(true) }],
  ])

  const failures = notOkLines(lines)
  assert.equal(failures.length, 1, 'one not ok line')
  assert.ok(failures[0].includes('boom'), 'the not ok line names the error')
  assert.ok(
    lines.indexOf(failures[0]) < lines.indexOf('# after'),
    'the next test runs after the failure'
  )
  assert.deepEqual(result, { total: 2, success: 1, fail: 1 })
  assert.end()
})

test('a test whose promise rejects is reported as not ok', async (assert) => {
  const { lines, result } = await runCases([
    ['rejects', async (t) => {
      t.ok(true)
      await Promise.resolve()
      throw new Error('async boom')
    }],
    ['after', (t) => { t.ok(true) }],
  ])

  const failures = notOkLines(lines)
  assert.equal(failures.length, 1, 'one not ok line')
  assert.ok(
    failures[0].includes('async boom'),
    'the not ok line names the error'
  )
  assert.ok(
    lines.indexOf(failures[0]) < lines.indexOf('# after'),
    'the next test runs after the failure'
  )
  assert.deepEqual(result, { total: 3, success: 2, fail: 1 })
  assert.end()
})

test('a test that misses its plan is reported as not ok', async (assert) => {
  const { lines, result } = await runCases([
    ['too few', (t) => {
      t.plan(2, 50)
      t.ok(true)
    }],
    ['after', (t) => { t.ok(true) }],
  ])

  const failures = notOkLines(lines)
  assert.equal(failures.length, 1, 'one not ok line')
  assert.ok(
    lines.indexOf(failures[0]) < lines.indexOf('# after'),
    'the next test runs after the failure'
  )
  assert.deepEqual(result, { total: 3, success: 2, fail: 1 })
  assert.end()
})

test('a test with more assertions than planned is not ok', async (assert) => {
  const { lines, result } = await runCases([
    ['too many', (t) => {
      t.plan(1)
      t.ok(true)
      t.ok(true)
    }],
    ['after', (t) => { t.ok(true) }],
  ])

  const failures = notOkLines(lines)
  assert.equal(failures.length, 1, 'one not ok line')
  assert.ok(
    lines.indexOf(failures[0]) < lines.indexOf('# after'),
    'the next test runs after the failure'
  )
  assert.deepEqual(result, { total: 3, success: 2, fail: 1 })
  assert.end()
})

test('a test that throws after meeting its plan is not ok', async (assert) => {
  const { lines, result } = await runCases([
    ['throws late', (t) => {
      t.plan(1)
      t.ok(true)
      throw new Error('late boom')
    }],
    ['after', (t) => { t.ok(true) }],
  ])

  const failures = notOkLines(lines)
  assert.equal(failures.length, 1, 'one not ok line')
  assert.ok(
    failures[0].includes('late boom'),
    'the not ok line names the error'
  )
  assert.deepEqual(result, { total: 3, success: 2, fail: 1 })
  assert.end()
})

test('an assertion after a planned test ends is rejected', async (assert) => {
  /** @type {import('../../index.js').Test | undefined} */
  let late
  await runCases([
    ['times out', (t) => {
      late = t
      t.plan(2, 50)
      t.ok(true)
    }],
  ])

  if (!late) throw new Error('test did not run')
  const t = late
  assert.throws(
    () => t.ok(true),
    /after test was finished/,
    'says the test already finished'
  )
  assert.end()
})

test('a failure in an ES module reports where it happened', async (assert) => {
  const { lines } = await runCases([
    ['fails', (t) => { t.ok(false) }],
    ['throws', () => { throw new Error('boom') }],
  ])

  const atLines = lines.filter((line) => /^ {4}at: /.test(line))
  assert.equal(atLines.length, 2, 'each failure has an at line')
  for (const line of atLines) {
    assert.ok(line.includes('errors.js:'), 'the at line points at the test')
  }
  assert.end()
})
