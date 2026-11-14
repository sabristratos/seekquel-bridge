import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewer } from '../src/version.js';

test('a version is newer only when a part of it is higher', () => {
  assert.equal(isNewer('0.1.3', '0.1.2'), true);
  assert.equal(isNewer('0.2', '0.1.9'), true);
  assert.equal(isNewer('v1.0.0', '0.9.9'), true);
  assert.equal(isNewer('0.1.2', '0.1.2'), false);
  assert.equal(isNewer('0.1.1', '0.1.2'), false);
  assert.equal(isNewer('0.1.10', '0.1.9'), true);
  assert.equal(isNewer('0.2.0-beta', '0.1.2'), false);
  assert.equal(isNewer(null, '0.1.2'), false);
});
