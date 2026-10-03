import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHiborJson, mergeHibor, parseHkabJson, hkabUrl } from '../scripts/parse-hibor.mjs';

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

test('merging keeps history and lets newer fixings win', () => {
  const older = [{ effective: '2026-08-28', rate: 2.8 }, { effective: '1996-07-01', rate: 5.5 }];
  const newer = [{ effective: '2026-08-31', rate: 2.85 }, { effective: '2026-08-28', rate: 2.85 }];
  assert.deepEqual(mergeHibor(older, newer), [
    { effective: '2026-08-31', rate: 2.85 },
    { effective: '2026-08-28', rate: 2.85 },
    { effective: '1996-07-01', rate: 5.5 },
  ]);
});

test('HKAB: reads one day per tenor; holidays, weekends and other dates give nothing', () => {
  const day = { '1 Month': 2.96839, '3 Months': 3.24482, year: 2026, month: 10, day: 2, isHoliday: false };
  assert.deepEqual(parseHkabJson(day, '2026-10-02', '1m'), { effective: '2026-10-02', rate: 2.96839 });
  assert.deepEqual(parseHkabJson(day, '2026-10-02', '3m'), { effective: '2026-10-02', rate: 3.24482 });
  assert.equal(parseHkabJson(day, '2026-10-01', '1m'), null); // answered for a different day
  const holiday = { '1 Month': null, '3 Months': null, year: null, month: null, day: null };
  assert.equal(parseHkabJson(holiday, '2026-10-01', '1m'), null);
  assert.equal(hkabUrl('2026-09-05'), 'https://www.hkab.org.hk/api/hibor?year=2026&month=9&day=5');
});
