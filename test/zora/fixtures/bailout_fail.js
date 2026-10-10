import { test } from '../../../index.js'

test('will not go to the end', function (t) {
    t.ok(true, 'okay');

    throw new Error('Oh no!');

    t.fail('should never be reached')
});

test('the next test still runs', t => {
    t.ok(true, 'runs after the throw');
});
