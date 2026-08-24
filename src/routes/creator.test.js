import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'a'.repeat(48); // creator.js -> middleware/auth.js needs one at import

const { parseByteRange } = await import('./creator.js');

test('parseByteRange', async (t) => {
  await t.test('open-ended range runs to the last byte', () => {
    assert.deepEqual(parseByteRange('bytes=0-', 100), { start: 0, end: 99 });
    assert.deepEqual(parseByteRange('bytes=50-', 100), { start: 50, end: 99 });
  });

  await t.test('closed range is inclusive and clamped to the file', () => {
    assert.deepEqual(parseByteRange('bytes=0-9', 100), { start: 0, end: 9 });
    assert.deepEqual(parseByteRange('bytes=90-9999', 100), { start: 90, end: 99 });
  });

  await t.test('suffix range means the LAST n bytes', () => {
    assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
    // Longer than the file: the whole file, not a negative start.
    assert.deepEqual(parseByteRange('bytes=-500', 100), { start: 0, end: 99 });
  });

  await t.test('unsatisfiable and malformed ranges return null', () => {
    assert.equal(parseByteRange('bytes=100-', 100), null); // start past EOF
    assert.equal(parseByteRange('bytes=50-10', 100), null); // inverted
    assert.equal(parseByteRange('bytes=-0', 100), null);
    assert.equal(parseByteRange('bytes=-', 100), null);
    assert.equal(parseByteRange('bytes=0-1,5-6', 100), null); // multi-range
    assert.equal(parseByteRange('items=0-1', 100), null); // wrong unit
    assert.equal(parseByteRange('garbage', 100), null);
    assert.equal(parseByteRange('bytes=0-', 0), null); // empty file
  });
});
