import { test } from '../../../index.js'

test('first test passes', t => {
    t.ok(true, 'before the throw')
})

test('second test throws', async t => {
    t.ok(true, 'an assertion before the throw')
    await Promise.resolve()
    throw new Error('boom from inside a test')
})

test('third test still runs', t => {
    t.ok(true, 'after the throw')
})
