import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHiborJson } from '../scripts/parse-hibor.mjs';

test('parses 1-month HIBOR from the HKMA API shape, newest first, skipping blanks', () => {
  const json = {
    header: { success: true, err_code: '0000', err_msg: 'No error found' },
    result: {
      datasize: 3,
      records: [
        { end_of_day: '2026-09-28', ir_overnight: 4.1, ir_1w: 3.3, ir_1m: 2.99876, ir_3m: 3.2 },
        { end_of_day: '2026-09-29', ir_overnight: 4.08, ir_1w: 3.27, ir_1m: 3.00518, ir_3m: 3.24 },
        { end_of_day: '2026-09-27', ir_1m: null },
      ],
    },
  };
  assert.deepEqual(parseHiborJson(json), [
    { effective: '2026-09-29', rate: 3.00518 },
    { effective: '2026-09-28', rate: 2.99876 },
  ]);
});

test('reports API errors and empty data', () => {
  assert.throws(() => parseHiborJson({ header: { success: false, err_msg: 'Bad request' } }), /Bad request/);
  assert.throws(() => parseHiborJson({ header: { success: true }, result: { records: [] } }), /No HIBOR/);
});
