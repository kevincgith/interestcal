import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outdated } from '../scripts/vendor.mjs';

// The site serves copies of the export libraries; after a dependency update they must be re-copied (npm run vendor).
test('site/vendor matches the installed libraries', async () => {
  assert.deepEqual(await outdated(), [], 'site/vendor is out of date. Run: npm run vendor');
});
